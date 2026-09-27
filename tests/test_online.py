import io
import json
import os
import unittest
from unittest.mock import patch
from zipfile import ZipFile
import online


def request(path, method='GET', data=None, token=None, origin='http://127.0.0.1:8001'):
    body = json.dumps(data).encode() if data is not None else b''
    env = {'PATH_INFO': path, 'REQUEST_METHOD': method, 'CONTENT_TYPE': 'application/json',
           'CONTENT_LENGTH': str(len(body)), 'wsgi.input': io.BytesIO(body), 'HTTP_ORIGIN': origin,
           'HTTP_COOKIE': f'rt_session={token}' if token else ''}
    result = {}
    def start(status, headers):
        result.update(status=int(status[:3]), headers=headers)
    result['body'] = b''.join(online.app(env, start))
    return result


def provider(path, method='GET', data=None, token=None):
    if path.startswith('/auth/v1/token'):
        if data['password'] != 'test-password':
            raise online.ApiError(401, 'Acesso inválido')
        return {'access_token': 'test-token', 'expires_in': 3600}
    if token != 'test-token':
        raise online.ApiError(401, 'Sessão expirada')
    if path == '/auth/v1/user': return {'id': 'user-a', 'email': 'test@example.invalid'}
    if path.startswith('/rest/v1/rt_members'): return [{'user_id': 'user-a'}]
    if path.startswith('/rest/v1/rt_state'): return [{'items': {}, 'revision': 1}]
    if path == '/rest/v1/rpc/save_rt_state':
        if data['expected_revision'] != 1: raise online.ApiError(409, 'Conflito')
        return 2
    if path.startswith('/auth/v1/logout'): return None
    raise AssertionError(path)


class OnlineTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {'APP_ORIGIN': 'http://127.0.0.1:8001'})
        self.env.start()
        self.remote = patch('online.remote', side_effect=provider)
        self.remote.start()
        self.addCleanup(self.env.stop)
        self.addCleanup(self.remote.stop)

    def test_private_assets_and_data_require_login(self):
        for path in ['/src/seed.json', '/api/state', '/templates/escala-medica-oficial.xlsx', '/src/app.js']:
            self.assertEqual(request(path)['status'], 401)
        self.assertEqual(request('/')['status'], 303)

    def test_login_sets_http_only_cookie_and_bad_password_rejected(self):
        result = request('/api/login', 'POST', {'email': 'test@example.invalid', 'password': 'test-password'})
        self.assertEqual(result['status'], 200)
        cookie = dict(result['headers'])['Set-Cookie']
        self.assertIn('HttpOnly', cookie)
        self.assertIn('SameSite=Strict', cookie)
        self.assertEqual(request('/api/login', 'POST', {'email':'x', 'password':'bad'})['status'], 401)

    def test_production_cookie_is_secure(self):
        with patch.dict(os.environ, {'APP_ORIGIN': 'https://example.invalid'}):
            result = request('/api/login', 'POST', {'email':'x', 'password':'test-password'}, origin='https://example.invalid')
            self.assertIn('Secure', dict(result['headers'])['Set-Cookie'])

    def test_cross_origin_write_rejected(self):
        result = request('/api/state', 'PUT', {'items': {}, 'revision': 1}, 'test-token', 'https://evil.invalid')
        self.assertEqual(result['status'], 403)

    def test_read_save_and_stale_revision(self):
        self.assertEqual(request('/api/state', token='test-token')['status'], 200)
        saved = request('/api/state', 'PUT', {'items': {'rt-upa:doctors':'["TESTE"]'}, 'revision':1}, 'test-token')
        self.assertEqual(json.loads(saved['body'])['revision'], 2)
        self.assertEqual(request('/api/state', 'PUT', {'items': {}, 'revision':0}, 'test-token')['status'], 409)

    def test_expired_session(self):
        self.assertEqual(request('/api/state', token='expired')['status'], 401)

    def test_non_member_denied(self):
        def no_member(path, **kwargs):
            return [] if 'rt_members' in path else provider(path, **kwargs)
        with patch('online.remote', side_effect=no_member):
            self.assertEqual(request('/api/state', token='test-token')['status'], 403)

    def test_server_source_and_template_never_downloadable(self):
        for path in ['/online.py', '/.env', '/templates/escala-medica-oficial.xlsx', '/src/../online.py']:
            self.assertEqual(request(path, token='test-token')['status'], 404)

    def test_malformed_backup_rejected(self):
        for items in [{'rt-upa:fixed':'null'}, {'rt-upa:unknown':'{}'}, {'rt-upa:doctors':'[{}]'}, {'rt-upa:edits:2026:10:1':'{"x":"y"}'}]:
            self.assertEqual(request('/api/state', 'PUT', {'items':items, 'revision':1}, 'test-token')['status'], 400)

    def test_export_preserves_template_parts_and_user_edit(self):
        payload = {'year':2026, 'month':10, 'half':1, 'items':{'rt-upa:edits:2026:10:1':json.dumps({'2026-10-01|0':'TESTE EXPORTAÇÃO'})}}
        result = request('/api/export', 'POST', payload, 'test-token')
        self.assertEqual(result['status'], 200)
        with ZipFile(io.BytesIO(result['body'])) as output, ZipFile(online.DEFAULT_TEMPLATE) as original:
            self.assertIsNone(output.testzip())
            self.assertEqual(output.namelist(), original.namelist())
            self.assertEqual([name for name in original.namelist() if output.read(name) != original.read(name)], ['xl/worksheets/sheet1.xml'])
            self.assertIn('TESTE EXPORTAÇÃO', output.read('xl/worksheets/sheet1.xml').decode())


if __name__ == '__main__': unittest.main()
