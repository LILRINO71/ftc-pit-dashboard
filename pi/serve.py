"""Local web server for the pit dashboard.

Same as `python3 -m http.server`, but tells the browser to re-check files on every load,
so an updated dashboard shows up after a reboot instead of a cached old copy.
Usage: python3 serve.py <port> <folder>
"""
import functools
import http.server
import sys


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      ".js": "text/javascript", ".mjs": "text/javascript",
                      ".glb": "model/gltf-binary", ".woff2": "font/woff2"}

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def log_message(self, *args):
        pass  # keep the journal quiet


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8770
    folder = sys.argv[2] if len(sys.argv) > 2 else "."
    handler = functools.partial(NoCacheHandler, directory=folder)
    http.server.ThreadingHTTPServer(("127.0.0.1", port), handler).serve_forever()
