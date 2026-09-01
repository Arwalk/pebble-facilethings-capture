// Exercises the pkjs layers against stubbed XMLHttpRequest / localStorage / Pebble.
// The emulator cannot run here (stpyv8 has no linux-aarch64 wheel), so this is the
// gate for the phone side.

var assert = require('assert');
var path = require('path');

var PKJS = path.join(__dirname, '..', 'src', 'pkjs');

var SECRET = 'sekret-value';
var REFRESH = 'refresh-1';
var ACCESS = 'access-1';

var requests, logs, sent, pending;

// Kept before the stub replaces global.console.
var report = console.log.bind(console);

function reset_globals(responder) {
  requests = [];
  logs = [];
  sent = [];
  pending = [];

  var store = {};
  global.localStorage = {
    getItem: function(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem: function(k, v) { store[k] = String(v); },
    removeItem: function(k) { delete store[k]; }
  };

  global.console = { log: function(m) { logs.push(String(m)); } };

  global.Pebble = {
    addEventListener: function(name, fn) { (global.Pebble._h[name] = global.Pebble._h[name] || []).push(fn); },
    sendAppMessage: function(msg) { sent.push(msg); },
    openURL: function(url) { sent.push({ openURL: url }); },
    _h: {},
    fire: function(name, e) { (global.Pebble._h[name] || []).forEach(function(fn) { fn(e); }); }
  };

  global.XMLHttpRequest = function() {
    var self = this;
    self._headers = {};

    self.open = function(method, url) { self._method = method; self._url = url; };
    self.setRequestHeader = function(k, v) { self._headers[k] = v; };

    function deliver(res) {
      if (res.network) return self.onerror();
      if (res.timeout) return self.ontimeout();

      self.status = res.status;
      self.responseText = JSON.stringify(res.body === undefined ? {} : res.body);
      self.onload();
    }

    self.send = function(body) {
      var req = { method: self._method, url: self._url, headers: self._headers, body: body };
      requests.push(req);

      var res = responder(req, requests.length - 1);

      // A responder can hold a request open, so a test can act while it is in
      // flight. pending[i](res) then completes it.
      if (res.defer) return pending.push(deliver);

      deliver(res);
    };
  };

  // Fresh module state per case.
  ['http', 'config', 'ft_client', 'index'].forEach(function(m) {
    delete require.cache[require.resolve(path.join(PKJS, m + '.js'))];
  });
}

function load(name) { return require(path.join(PKJS, name + '.js')); }

function seed(cfg) {
  var config = load('config');
  config.update(cfg);
  return config;
}

function full_config(over) {
  var cfg = {
    client_id: 'cid-1',
    client_secret: SECRET,
    refresh_token: REFRESH,
    access_token: ACCESS,
    expires_at: Date.now() + 3600000
  };
  Object.keys(over || {}).forEach(function(k) { cfg[k] = over[k]; });
  return cfg;
}

var passed = 0, failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    report('  ok   ' + name);
  } catch (e) {
    failed++;
    report('  FAIL ' + name + '\n       ' + e.message);
  }
}

function body_of(req) { return JSON.parse(req.body); }

function form_of(req) {
  var out = {};
  req.body.split('&').forEach(function(pair) {
    var kv = pair.split('=');
    out[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1]);
  });
  return out;
}

// -- ft_client ---------------------------------------------------------------

test('valid token posts once and reports success', function() {
  reset_globals(function() { return { status: 201, body: { id: 1 } }; });
  seed(full_config());

  var result = 'unset';
  load('ft_client').capture('acheter du pain', function(kind) { result = kind; });

  assert.strictEqual(result, null, 'expected success');
  assert.strictEqual(requests.length, 1, 'expected exactly one request');
  assert.strictEqual(requests[0].url, 'https://api2.facilethings.com/v2/stuff');
  assert.strictEqual(requests[0].method, 'POST');
  assert.strictEqual(requests[0].headers.Authorization, 'Bearer ' + ACCESS);
  assert.strictEqual(body_of(requests[0]).text, 'acheter du pain');
});

test('expired token refreshes then posts', function() {
  reset_globals(function(req) {
    if (req.url.indexOf('/oauth/token') !== -1) {
      return { status: 200, body: { access_token: 'access-2', expires_in: 7200 } };
    }
    return { status: 201, body: {} };
  });
  seed(full_config({ expires_at: Date.now() - 1000 }));

  var result = 'unset';
  load('ft_client').capture('note', function(kind) { result = kind; });

  assert.strictEqual(result, null);
  assert.strictEqual(requests.length, 2);

  var form = form_of(requests[0]);
  assert.strictEqual(form.grant_type, 'refresh_token');
  assert.strictEqual(form.refresh_token, REFRESH);
  assert.strictEqual(form.client_secret, SECRET, 'confidential client must send the secret');
  assert.strictEqual(requests[1].headers.Authorization, 'Bearer access-2');
});

test('rotated refresh token is persisted', function() {
  reset_globals(function(req) {
    if (req.url.indexOf('/oauth/token') !== -1) {
      return { status: 200, body: { access_token: 'a2', refresh_token: 'refresh-2', expires_in: 7200 } };
    }
    return { status: 201, body: {} };
  });
  var config = seed(full_config({ expires_at: 0 }));

  load('ft_client').capture('note', function() {});

  assert.strictEqual(config.get().refresh_token, 'refresh-2', 'rotation must be stored');
});

test('missing config short-circuits without any request', function() {
  reset_globals(function() { throw new Error('must not send'); });

  var result = 'unset';
  load('ft_client').capture('note', function(kind) { result = kind; });

  assert.strictEqual(result, 'noconfig');
  assert.strictEqual(requests.length, 0);
});

test('refresh rejected maps to auth', function() {
  reset_globals(function() { return { status: 401, body: { error: 'invalid_grant' } }; });
  seed(full_config({ expires_at: 0 }));

  var result = 'unset';
  load('ft_client').capture('note', function(kind) { result = kind; });

  assert.strictEqual(result, 'auth');
});

test('401 on a fresh-looking token refreshes and retries once', function() {
  var posts = 0;
  reset_globals(function(req) {
    if (req.url.indexOf('/oauth/token') !== -1) {
      return { status: 200, body: { access_token: 'access-3', expires_in: 7200 } };
    }
    posts++;
    return posts === 1 ? { status: 401, body: {} } : { status: 201, body: {} };
  });
  seed(full_config());

  var result = 'unset';
  load('ft_client').capture('note', function(kind) { result = kind; });

  assert.strictEqual(result, null, 'retry should succeed');
  assert.strictEqual(posts, 2, 'exactly one retry');
});

test('401 twice gives up as auth', function() {
  reset_globals(function(req) {
    if (req.url.indexOf('/oauth/token') !== -1) {
      return { status: 200, body: { access_token: 'a', expires_in: 7200 } };
    }
    return { status: 401, body: {} };
  });
  seed(full_config());

  var result = 'unset';
  load('ft_client').capture('note', function(kind) { result = kind; });

  assert.strictEqual(result, 'auth');
});

test('403 maps to auth', function() {
  reset_globals(function() { return { status: 403, body: {} }; });
  seed(full_config());

  var result = 'unset';
  load('ft_client').capture('note', function(kind) { result = kind; });

  assert.strictEqual(result, 'auth');
});

test('500 maps to api', function() {
  reset_globals(function() { return { status: 500, body: {} }; });
  seed(full_config());

  var result = 'unset';
  load('ft_client').capture('note', function(kind) { result = kind; });

  assert.strictEqual(result, 'api');
});

test('422 maps to api', function() {
  reset_globals(function() { return { status: 422, body: { errors: { text: ["can't be blank"] } } }; });
  seed(full_config());

  var result = 'unset';
  load('ft_client').capture('', function(kind) { result = kind; });

  assert.strictEqual(result, 'api');
});

test('network failure maps to transport', function() {
  reset_globals(function() { return { network: true }; });
  seed(full_config());

  var result = 'unset';
  load('ft_client').capture('note', function(kind) { result = kind; });

  assert.strictEqual(result, 'transport');
});

test('timeout maps to transport', function() {
  reset_globals(function() { return { timeout: true }; });
  seed(full_config());

  var result = 'unset';
  load('ft_client').capture('note', function(kind) { result = kind; });

  assert.strictEqual(result, 'transport');
});

// -- index.js wire behaviour -------------------------------------------------

test('success acks and remembers the id', function() {
  reset_globals(function() { return { status: 201, body: {} }; });
  seed(full_config());
  load('index');

  Pebble.fire('appmessage', { payload: { Id: 7, Text: 'acheter du pain' } });

  assert.deepStrictEqual(sent, [{ Id: 7, Ack: 1 }]);
  assert.ok(load('config').seen(7, 'acheter du pain'), 'the capture should be remembered');
});

// Signing in again may be a different account, and the remembered captures went
// to the old one.
test('a new sign in forgets the captures of the old account', function() {
  reset_globals(function() { return { status: 201, body: {} }; });
  var config = seed(full_config());
  config.remember(7, 'acheter du pain');
  load('index');

  var payload = { client_id: 'cid-2', refresh_token: 'refresh-2',
                  access_token: 'access-2', expires_at: Date.now() + 3600000 };
  Pebble.fire('webviewclosed', { response: encodeURIComponent(JSON.stringify(payload)) });

  assert.ok(!config.seen(7, 'acheter du pain'), 'captures from the old account must not persist');
});

test('a repeated id re-acks without posting again', function() {
  reset_globals(function() { return { status: 201, body: {} }; });
  seed(full_config());
  load('index');

  Pebble.fire('appmessage', { payload: { Id: 7, Text: 'acheter du pain' } });
  var after_first = requests.length;

  Pebble.fire('appmessage', { payload: { Id: 7, Text: 'acheter du pain' } });

  assert.strictEqual(requests.length, after_first, 'must not post twice');
  assert.deepStrictEqual(sent, [{ Id: 7, Ack: 1 }, { Id: 7, Ack: 1 }]);
});

// SECURITY REVIEW: watch persist (and with it the id counter) is wiped when the
// app is removed from the watch, so ids restart at 1 on a reinstall, while
// ft_seen in phone localStorage survives. A different capture that happens to
// reuse an old id is then silently acked and never posted: the watch shows
// "Captured", pops the item from its queue, and the note is gone. The dedup key
// must distinguish a resend of the same capture from a new capture reusing an id.
test('a reused id carrying different text is captured, not swallowed', function() {
  reset_globals(function() { return { status: 201, body: {} }; });
  seed(full_config());
  load('index');

  Pebble.fire('appmessage', { payload: { Id: 1, Text: 'call the dentist' } });
  assert.strictEqual(requests.length, 1, 'the first capture should be posted');

  // Same id, different dictation: the watch was reinstalled and restarted at 1.
  Pebble.fire('appmessage', { payload: { Id: 1, Text: 'buy milk on the way home' } });

  assert.strictEqual(requests.length, 2,
                     'a different capture must reach FacileThings, not be acked as a duplicate');
  assert.strictEqual(body_of(requests[1]).text, 'buy milk on the way home');
});

// The watch resends an item whose AppMessage was not acknowledged at the
// bluetooth layer, which is not the same as the phone never receiving it. Until
// the POST comes back the capture is not in the seen list yet, so a resend
// arriving in that window would file the note a second time.
test('a resend while the post is in flight does not file the note twice', function() {
  reset_globals(function() { return { defer: true }; });
  seed(full_config());
  load('index');

  var payload = { payload: { Id: 3, Text: 'acheter du pain' } };
  Pebble.fire('appmessage', payload);
  Pebble.fire('appmessage', payload);

  assert.strictEqual(requests.length, 1, 'the second send must not post again');

  pending[0]({ status: 201, body: {} });

  assert.deepStrictEqual(sent, [{ Id: 3, Ack: 1 }]);
});

test('failures map onto the MsgErr wire codes', function() {
  var cases = [
    { responder: function() { return { network: true }; }, cfg: full_config(), code: 1 },
    { responder: function() { return { status: 401, body: {} }; }, cfg: full_config(), code: 2 },
    { responder: function() { return { status: 500, body: {} }; }, cfg: full_config(), code: 3 },
    { responder: function() { return { status: 201, body: {} }; }, cfg: null, code: 4 }
  ];

  cases.forEach(function(c) {
    reset_globals(c.responder);
    if (c.cfg) seed(c.cfg);
    load('index');

    Pebble.fire('appmessage', { payload: { Id: 9, Text: 'note' } });

    assert.deepStrictEqual(sent, [{ Id: 9, Err: c.code }], 'code ' + c.code);
  });
});

test('ready announces itself to the watch', function() {
  reset_globals(function() { return { status: 201, body: {} }; });
  load('index');

  Pebble.fire('ready', {});

  assert.deepStrictEqual(sent, [{ Ready: 1 }]);
});

test('showConfiguration opens the hosted sign in page', function() {
  reset_globals(function() { return { status: 201, body: {} }; });
  load('index');

  Pebble.fire('showConfiguration', {});

  assert.strictEqual(sent.length, 1);
  assert.ok(/^https:\/\//.test(sent[0].openURL), 'must be https: ' + sent[0].openURL);
});

test('webviewclosed stores the credential set', function() {
  reset_globals(function() { return { status: 201, body: {} }; });
  load('index');

  var payload = { client_id: 'cid-1', refresh_token: REFRESH,
                  access_token: ACCESS, expires_at: Date.now() + 3600000 };
  Pebble.fire('webviewclosed', { response: encodeURIComponent(JSON.stringify(payload)) });

  var cfg = load('config').get();
  assert.strictEqual(cfg.refresh_token, REFRESH);
  assert.ok(!cfg.client_secret, 'a public client stores no secret');
});

test('a public client captures without sending a secret', function() {
  reset_globals(function(req) {
    if (req.url.indexOf('/oauth/token') !== -1) {
      return { status: 200, body: { access_token: 'a2', expires_in: 7200 } };
    }
    return { status: 201, body: {} };
  });
  seed({ client_id: 'cid-1', refresh_token: REFRESH, expires_at: 0 });

  var result = 'unset';
  load('ft_client').capture('note', function(kind) { result = kind; });

  assert.strictEqual(result, null, 'capture should succeed with no secret');

  var form = form_of(requests[0]);
  assert.strictEqual(form.grant_type, 'refresh_token');
  assert.ok(!('client_secret' in form), 'must not send client_secret: ' + requests[0].body);
});

test('disconnect revokes the refresh token and forgets it', function() {
  reset_globals(function() { return { status: 200, body: {} }; });
  var config = seed({ client_id: 'cid-1', refresh_token: REFRESH, access_token: ACCESS });
  load('index');

  Pebble.fire('webviewclosed', { response: encodeURIComponent(JSON.stringify({ disconnect: true })) });

  assert.strictEqual(requests.length, 1, 'expected one revoke call');
  assert.strictEqual(requests[0].url, 'https://api2.facilethings.com/oauth/revoke');

  var form = form_of(requests[0]);
  assert.strictEqual(form.token, REFRESH);
  assert.strictEqual(form.token_type_hint, 'refresh_token');
  assert.ok(!('client_secret' in form), 'public client sends no secret');

  assert.strictEqual(config.get(), null, 'credential must be gone');
});

test('disconnect forgets the token even when revoke fails', function() {
  reset_globals(function() { return { network: true }; });
  var config = seed({ client_id: 'cid-1', refresh_token: REFRESH });
  load('index');

  Pebble.fire('webviewclosed', { response: encodeURIComponent(JSON.stringify({ disconnect: true })) });

  assert.strictEqual(config.get(), null,
                     'an unreachable server must not leave the account connected');
});

test('disconnect clears the captured-id history', function() {
  reset_globals(function() { return { status: 200, body: {} }; });
  var config = seed({ client_id: 'cid-1', refresh_token: REFRESH });
  config.remember(7, 'acheter du pain');
  load('index');

  Pebble.fire('webviewclosed', { response: encodeURIComponent(JSON.stringify({ disconnect: true })) });

  assert.ok(!config.seen(7, 'acheter du pain'), 'captures from the old account must not persist');
});

test('the page is told whether an account is connected', function() {
  reset_globals(function() { return { status: 201, body: {} }; });
  load('index');

  Pebble.fire('showConfiguration', {});
  assert.ok(sent[0].openURL.indexOf('connected=1') === -1, 'fresh install offers Connect');

  reset_globals(function() { return { status: 201, body: {} }; });
  seed({ client_id: 'cid-1', refresh_token: REFRESH });
  load('index');

  Pebble.fire('showConfiguration', {});
  assert.ok(sent[0].openURL.indexOf('connected=1') !== -1, 'configured install offers Disconnect');
  assert.ok(sent[0].openURL.indexOf(REFRESH) === -1, 'no token may appear in the page URL');
});

test('an incomplete webview response is rejected', function() {
  reset_globals(function() { return { status: 201, body: {} }; });
  load('index');

  Pebble.fire('webviewclosed', { response: encodeURIComponent(JSON.stringify({ client_id: 'cid-1' })) });

  assert.strictEqual(load('config').get(), null, 'must not store a partial credential');
});

test('nothing secret reaches the log', function() {
  reset_globals(function(req) {
    if (req.url.indexOf('/oauth/token') !== -1) {
      return { status: 200, body: { access_token: 'a2', refresh_token: 'r2', expires_in: 10 } };
    }
    return { status: 201, body: {} };
  });
  seed(full_config({ expires_at: 0 }));
  load('index');

  Pebble.fire('appmessage', { payload: { Id: 3, Text: 'note' } });

  var joined = logs.join('\n');
  assert.ok(logs.length > 0, 'expected the request line to be logged');
  [SECRET, REFRESH, ACCESS, 'a2', 'r2'].forEach(function(v) {
    assert.ok(joined.indexOf(v) === -1, 'leaked ' + v + ' into: ' + joined);
  });
});

report('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
