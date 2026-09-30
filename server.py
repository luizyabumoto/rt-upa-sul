#!/usr/bin/env python3
"""Servidor local do protótipo: interface e exportação do Excel oficial."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import json
import tempfile
from urllib.parse import urlparse
from export_excel import export, export_cinderela, DEFAULT_TEMPLATE, nome_arquivo, content_disposition

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
        if urlparse(self.path).path not in ('/api/export','/api/export-pdf','/api/export-cinderela'):
            self.send_error(404)
            return
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= 2_000_000:
                raise ValueError('Pedido vazio ou muito grande')
            payload = json.loads(self.rfile.read(length))
            cinderela = urlparse(self.path).path == '/api/export-cinderela'
            year, month, half = (0, 0, 0) if cinderela else (int(payload[name]) for name in ('year', 'month', 'half'))
            items = payload.get('items', {})
            if not isinstance(items, dict) or len(items) > 1000:
                raise ValueError('Backup inválido')
            backup = {}
            for key, value in items.items():
                if not key.startswith('rt-upa:') or not isinstance(value, str):
                    raise ValueError('Backup inválido')
                backup[key[7:]] = json.loads(value)
            if urlparse(self.path).path == '/api/export-pdf':
                from export_pdf import export_pdf
                data=export_pdf(year,month,half,payload.get('kind'),payload.get('layout'),backup)
                self.send_response(200)
                self.send_header('Content-Type','application/pdf')
                self.send_header('Content-Disposition',content_disposition(nome_arquivo('cinderela' if payload.get('kind')=='cinderela' else 'regular',year,month,half,'pdf')))
                self.send_header('Content-Length',str(len(data)))
                self.end_headers();self.wfile.write(data);return
            with tempfile.TemporaryDirectory(prefix='rt-upa-') as temp:
                output = Path(temp) / 'escala.xlsx'
                if cinderela:
                    # Mesmo Excel quinzenal de cinderelas do site online (antes só existia lá).
                    info = export_cinderela(str(payload.get('date', '')), backup, output)
                    name = nome_arquivo('cinderela', info['ano'], info['mes'], info['quinzena'])
                else:
                    export(year, month, half, backup, DEFAULT_TEMPLATE, output)
                    name = nome_arquivo('regular', year, month, half)
                data = output.read_bytes()
            self.send_response(200)
            self.send_header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
            self.send_header('Content-Disposition', content_disposition(name))
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
