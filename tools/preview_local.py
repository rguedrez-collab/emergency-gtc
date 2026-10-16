"""Serve the generated UI on this machine with the in-process fake models of
verify_local.py, so the layout and flow can be inspected in a real browser
(directly or through a tunnel) without the VM, SSH or a GPU. Dialogue is
scripted and voices are placeholder tones; nothing here touches the VM.

  python3 tools/preview_local.py --password-file PATH [--port 8093] [--guarded] [--sites lyon:40,montreal:150 | --no-sites]

Basic auth user: demo. A missing password file is created with a random
password (mode 600); the password is never printed by this script.
--guarded adds the fake F5 tee proxy verdicts (one call blocked and held).
By default two fake caller sites run in this process (the real caller service
code without models, each with an extra delay standing in for distance), so
the console shows the sites and their latency; --no-sites keeps the built-in caller.
"""
import argparse
import base64
import os
import secrets
import socketserver
import sys
from pathlib import Path
from unittest.mock import patch

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "tests" / "e2e"))
sys.path.insert(0, str(REPO / "backend"))
import verify_local as v  # noqa: E402  reads --guarded/--oob/--realproxy from sys.argv at import


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--port", type=int, default=8093)
    parser.add_argument("--bind", default="127.0.0.1", help="0.0.0.0 inside a container")
    parser.add_argument("--password-file", type=Path, required=True, help="file holding the Basic auth password for user demo")
    parser.add_argument("--guarded", action="store_true", help="fake F5 tee proxy on the LLM path (verdict headers, one block)")
    parser.add_argument("--sites", default="lyon:40,montreal:150", help="fake caller sites name:extra_ms,...")
    parser.add_argument("--no-sites", action="store_true", help="built-in caller only")
    args = parser.parse_args()
    if not args.password_file.exists():
        fd = os.open(args.password_file, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w") as out:
            out.write(secrets.token_urlsafe(12) + "\n")
    password = args.password_file.read_text().strip()
    if not password:
        sys.exit("empty password file")
    socketserver.ThreadingTCPServer.allow_reuse_address = True
    socketserver.ThreadingTCPServer.daemon_threads = True
    httpd = socketserver.ThreadingTCPServer((args.bind, args.port), v.server.Handler)
    httpd.expected_auth = "Basic " + base64.b64encode(("demo:" + password).encode()).decode()
    sites = v.start_fake_sites(args.sites) if not (args.guarded or args.no_sites) else []
    with patch.object(v.server, "request_model", v.fake_request_model):
        print(f"Preview of {v.server.STATIC_FILE} on http://{args.bind}:{args.port} (user demo); "
              f"fake models{' + fake tee proxy verdicts' if args.guarded else ''}; "
              f"caller sites: {', '.join(s.cfg['location'] for s in sites) or 'built-in caller only'}; Ctrl-C stops.", flush=True)
        httpd.serve_forever()


if __name__ == "__main__":
    main()
