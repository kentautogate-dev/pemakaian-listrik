import functools
import http.server
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt, *args):
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8125
    handler = functools.partial(Handler, directory=ROOT)
    dengan = http.server.ThreadingHTTPServer(("127.0.0.1", port), handler)
    print("server di http://127.0.0.1:%d (root: %s)" % (port, ROOT), flush=True)
    dengan.serve_forever()
