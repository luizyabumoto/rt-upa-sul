#!/usr/bin/env python3
"""Servidor local do protótipo: interface e exportação do Excel oficial."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import json
import tempfile
from urllib.parse import urlparse
from export_excel import export, DEFAULT_TEMPLATE

ROOT = Path(__file__).resolve().parent


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self):
        if urlparse(self.path).path == '/api/session':
            data = b'{"mode":"local"}'
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        super().do_GET()

    def do_POST(self):
        if urlparse(self.path).path != '/api/export':
            self.send_error(404)
            return
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= 2_000_000:
                raise ValueError('Pedido vazio ou muito grande')
            payload = json.loads(self.rfile.read(length))
            year, month, half = (int(payload[name]) for name in ('year', 'month', 'half'))
            items = payload.get('items', {})
            if not isinstance(items, dict) or len(items) > 1000:
                raise ValueError('Backup inválido')
            backup = {}
            for key, value in items.items():
                if not key.startswith('rt-upa:') or not isinstance(value, str):
                    raise ValueError('Backup inválido')
                backup[key[7:]] = json.loads(value)
            with tempfile.TemporaryDirectory(prefix='rt-upa-') as temp:
                output = Path(temp) / 'escala.xlsx'
                export(year, month, half, backup, DEFAULT_TEMPLATE, output)
                data = output.read_bytes()
            name = f'ESCALA_MEDICA_{half}A_QUINZENA_{month:02d}_{year}_UPA_SUL.xlsx'
            self.send_response(200)
            self.send_header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
            self.send_header('Content-Disposition', f'attachment; filename="{name}"')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        except (ValueError, TypeError, KeyError, json.JSONDecodeError) as error:
            message = str(error).encode('utf8')
            self.send_response(400)
            self.send_header('Content-Type', 'text/plain; charset=utf-8')
            self.send_header('Content-Length', str(len(message)))
            self.end_headers()
            self.wfile.write(message)


if __name__ == '__main__':
    address = ('127.0.0.1', 8000)
    print(f'RT UPA Sul: http://{address[0]}:{address[1]}', flush=True)
    ThreadingHTTPServer(address, Handler).serve_forever()
