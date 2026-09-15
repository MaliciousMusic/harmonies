# Serveur statique de développement sans cache (python dev-server.py [port]).
# POST /__save?name=<fichier> : écrit le corps de la requête dans assets/<fichier> (génération des icônes PNG depuis tools/icons.html).
import os, re, sys, http.server, functools
class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()
    def log_message(self, fmt, *args):
        sys.stderr.write("%s %s\n" % (self.address_string(), fmt % args))
    def do_POST(self):
        m = re.match(r'^/__save\?name=([A-Za-z0-9_.-]+)$', self.path)
        if not m or '..' in m.group(1):
            self.send_error(404); return
        length = int(self.headers.get('Content-Length', 0))
        data = self.rfile.read(length)
        os.makedirs('assets', exist_ok=True)
        with open(os.path.join('assets', m.group(1)), 'wb') as f:
            f.write(data)
        self.send_response(200); self.send_header('Content-Type', 'text/plain'); self.end_headers()
        self.wfile.write(('saved %d bytes' % len(data)).encode())
port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
http.server.ThreadingHTTPServer.allow_reuse_address = True
http.server.ThreadingHTTPServer(('127.0.0.1', port), functools.partial(Handler, directory='.')).serve_forever()
