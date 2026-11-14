#!/usr/bin/env python3
"""Локальный сервер для плеера с правильными MIME-типами для PWA.

Запуск:  python3 serve.py [порт]
Открывать: http://localhost:8000/
"""
import sys
import os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
ROOT = os.path.dirname(os.path.abspath(__file__))

# Важно для установки на Android: манифест должен отдаваться как manifest+json
SimpleHTTPRequestHandler.extensions_map.update({
    ".webmanifest": "application/manifest+json",
    ".json": "application/json",
    ".js": "text/javascript",
    ".svg": "image/svg+xml",
})


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        # Service worker и манифест не должны залипать в кэше
        if self.path.endswith(("service-worker.js", "manifest.webmanifest")):
            self.send_header("Cache-Control", "no-cache")
        self.send_header("Service-Worker-Allowed", "/")
        super().end_headers()

    def log_message(self, fmt, *args):
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))


if __name__ == "__main__":
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print(f"Аудиоплеер: http://localhost:{PORT}/  (каталог {ROOT})", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
