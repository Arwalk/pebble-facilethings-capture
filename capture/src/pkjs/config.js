// Credential store and config page. Owns localStorage; no HTTP, no dictation
// knowledge. The credential is never logged.
//
// The page is a data: URI built here, so there is nothing to host and no build
// dependency. It only collects three values, all produced by
// tools/ft_auth.py --password.

var KEY_CONFIG = 'ft_config';
var KEY_SEEN = 'ft_seen';

var SEEN_MAX = 20;

function get() {
  try {
    return JSON.parse(localStorage.getItem(KEY_CONFIG)) || null;
  } catch (e) {
    return null;
  }
}

function put(cfg) {
  localStorage.setItem(KEY_CONFIG, JSON.stringify(cfg));
}

function update(patch) {
  var cfg = get() || {};

  Object.keys(patch).forEach(function(name) {
    cfg[name] = patch[name];
  });

  put(cfg);
}

// Ids of items FacileThings already accepted. Guards the window where a 201 is
// followed by a lost ack, which would otherwise capture the item twice.
function seen_ids() {
  try {
    return JSON.parse(localStorage.getItem(KEY_SEEN)) || [];
  } catch (e) {
    return [];
  }
}

function seen(id) {
  return seen_ids().indexOf(id) !== -1;
}

function remember(id) {
  var ids = seen_ids();
  ids.push(id);

  localStorage.setItem(KEY_SEEN, JSON.stringify(ids.slice(-SEEN_MAX)));
}

// -- config page ------------------------------------------------------------

function escape_attr(value) {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

// Only the client id is put into the page. The secret and the refresh token are
// left blank and blank means "keep what is stored", so they never travel in a URL.
function page(client_id, stored) {
  var hint = stored ? 'leave blank to keep' : 'required';

  return [
    '<!DOCTYPE html><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<style>',
    'body{font:16px system-ui,sans-serif;margin:0;padding:24px;background:#fff;color:#111}',
    'h1{font-size:20px;margin:0 0 4px}p{margin:0 0 20px;color:#555;font-size:13px}',
    'label{display:block;margin:14px 0 4px;font-weight:600;font-size:13px}',
    'input{width:100%;box-sizing:border-box;padding:12px;font-size:16px;',
    'border:1px solid #bbb;border-radius:6px}',
    'button{width:100%;margin-top:22px;padding:14px;font-size:16px;font-weight:600;',
    'border:0;border-radius:6px;background:#d43900;color:#fff}',
    '</style>',
    '<h1>FT Capture</h1>',
    '<p>From: python3 tools/ft_auth.py --password</p>',
    '<label>Client ID</label>',
    '<input id="i" autocomplete="off" autocapitalize="off" spellcheck="false" value="',
    escape_attr(client_id), '">',
    '<label>Client secret</label>',
    '<input id="s" type="password" autocomplete="off" placeholder="', hint, '">',
    '<label>Refresh token</label>',
    '<input id="r" type="password" autocomplete="off" placeholder="', hint, '">',
    '<button id="go">Save</button>',
    '<script>',
    'document.getElementById("go").onclick=function(){',
    'var d={client_id:document.getElementById("i").value.trim(),',
    'client_secret:document.getElementById("s").value.trim(),',
    'refresh_token:document.getElementById("r").value.trim()};',
    'location.href="pebblejs://close#"+encodeURIComponent(JSON.stringify(d));};',
    '<\/script>'
  ].join('');
}

function open_page() {
  var cfg = get() || {};
  var stored = !!(cfg.client_secret && cfg.refresh_token);

  Pebble.openURL('data:text/html;charset=utf-8,'
    + encodeURIComponent(page(cfg.client_id || '', stored)));
}

// A blank field keeps the stored value, so the secret need only be typed once.
function save_from_webview(response) {
  if (!response) return;

  var data;
  try {
    data = JSON.parse(decodeURIComponent(response));
  } catch (e) {
    console.log('config: unreadable response');
    return;
  }

  var cfg = get() || {};
  var next = {
    client_id: data.client_id || cfg.client_id,
    client_secret: data.client_secret || cfg.client_secret,
    refresh_token: data.refresh_token || cfg.refresh_token
  };

  if (!next.client_id || !next.client_secret || !next.refresh_token) {
    console.log('config: incomplete, not saved');
    return;
  }

  // A new refresh token invalidates whatever access token was cached.
  put(next);
  console.log('config: saved');
}

module.exports = {
  get: get,
  update: update,
  seen: seen,
  remember: remember,
  open_page: open_page,
  save_from_webview: save_from_webview
};
