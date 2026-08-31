#!/usr/bin/env python3
"""One-shot FacileThings authorization.

FacileThings v2 grants only authorization_code and refresh_token (PKCE S256),
so a browser has to log you in once. This does that and prints the refresh
token to paste into the watchapp's settings.

  loopback (needs http://127.0.0.1:8765/callback registered on your client):
      python3 tools/ft_auth.py --client-id ID --client-secret SECRET

  out of band (needs urn:ietf:wg:oauth:2.0:oob registered):
      python3 tools/ft_auth.py --client-id ID --client-secret SECRET --oob

  probe (prints URLs to open by hand to see which redirect uri is registered):
      python3 tools/ft_auth.py --client-id ID --probe
"""

import argparse
import base64
import hashlib
import http.server
import json
import secrets
import threading
import urllib.parse
import urllib.request

BASE = 'https://api2.facilethings.com'
AUTHORIZE = BASE + '/oauth/authorize'
TOKEN = BASE + '/oauth/token'
SCOPE = 'user'

OOB_URI = 'urn:ietf:wg:oauth:2.0:oob'
LOOPBACK_PORT = 8765
LOOPBACK_URI = 'http://127.0.0.1:%d/callback' % LOOPBACK_PORT

HTTP_OK = 200


def b64url(raw):
    return base64.urlsafe_b64encode(raw).decode().rstrip('=')


def make_pkce():
    verifier = b64url(secrets.token_bytes(32))
    challenge = b64url(hashlib.sha256(verifier.encode()).digest())
    return verifier, challenge


def authorize_url(client_id, redirect_uri, challenge, state):
    return AUTHORIZE + '?' + urllib.parse.urlencode({
        'response_type': 'code',
        'client_id': client_id,
        'redirect_uri': redirect_uri,
        'scope': SCOPE,
        'state': state,
        'code_challenge': challenge,
        'code_challenge_method': 'S256',
    })


def exchange(client_id, client_secret, code, redirect_uri, verifier):
    body = urllib.parse.urlencode({
        'grant_type': 'authorization_code',
        'code': code,
        'redirect_uri': redirect_uri,
        'client_id': client_id,
        'client_secret': client_secret,
        'code_verifier': verifier,
    }).encode()

    req = urllib.request.Request(TOKEN, data=body, method='POST')
    req.add_header('Content-Type', 'application/x-www-form-urlencoded')

    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            return res.status, json.loads(res.read())
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw)
        except ValueError:
            return e.code, {'error': raw.decode('utf8', 'ignore')[:400]}


# -- loopback ---------------------------------------------------------------

class Catcher(http.server.BaseHTTPRequestHandler):
    result = {}

    def do_GET(self):
        Catcher.result = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(self.path).query))

        self.send_response(HTTP_OK)
        self.send_header('Content-Type', 'text/plain; charset=utf-8')
        self.end_headers()
        self.wfile.write('Done. Close this tab and return to the terminal.\n'.encode())

        threading.Thread(target=self.server.shutdown, daemon=True).start()

    def log_message(self, *args):
        pass


def wait_for_code():
    server = http.server.HTTPServer(('127.0.0.1', LOOPBACK_PORT), Catcher)
    server.serve_forever()
    server.server_close()
    return Catcher.result


# -- entry ------------------------------------------------------------------

def probe(client_id):
    verifier, challenge = make_pkce()

    print('Log in first:      %s/oauth/login' % BASE)
    print('Then open each URL below. One will show a consent screen; the rest')
    print('will say the redirect uri is not valid. The one that works is the')
    print('redirect uri registered on your client.\n')

    for name, uri in (('loopback', LOOPBACK_URI),
                      ('out of band', OOB_URI),
                      ('github pages', 'https://arwalk.github.io/pebble-facilethings-capture/')):
        print('%s:\n  %s\n' % (name, authorize_url(client_id, uri, challenge, 'probe')))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--client-id', required=True)
    ap.add_argument('--client-secret')
    ap.add_argument('--oob', action='store_true', help='paste the code by hand')
    ap.add_argument('--probe', action='store_true', help='only print URLs to try')
    args = ap.parse_args()

    if args.probe:
        probe(args.client_id)
        return

    if not args.client_secret:
        ap.error('--client-secret is required unless --probe')

    verifier, challenge = make_pkce()
    state = secrets.token_urlsafe(16)
    redirect_uri = OOB_URI if args.oob else LOOPBACK_URI

    print('Open this in your browser:\n\n  %s\n'
          % authorize_url(args.client_id, redirect_uri, challenge, state))

    if args.oob:
        code = input('Paste the code shown by FacileThings: ').strip()
    else:
        print('Waiting for the redirect on %s ...' % LOOPBACK_URI)
        got = wait_for_code()

        if got.get('state') != state:
            raise SystemExit('state mismatch, start again')
        if 'error' in got:
            raise SystemExit('authorization refused: %s' % got.get('error_description', got['error']))

        code = got.get('code', '')

    if not code:
        raise SystemExit('no code received')

    status, body = exchange(args.client_id, args.client_secret, code, redirect_uri, verifier)

    if status != HTTP_OK or 'refresh_token' not in body:
        raise SystemExit('exchange failed (%s): %s'
                         % (status, body.get('error_description') or body.get('error') or body))

    print('\nrefresh_token:\n\n  %s\n' % body['refresh_token'])
    print('Paste it, with your client id and secret, into the watchapp settings.')


if __name__ == '__main__':
    main()
