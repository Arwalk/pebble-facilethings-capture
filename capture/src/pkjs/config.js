// Credential store and config page wiring. Owns localStorage; no HTTP, no
// dictation knowledge. The credential is never logged.
//
// Sign in happens on the hosted page, which runs authorization_code + PKCE and
// hands back the tokens. This is a public client, so there is no secret to
// store or to type.

// Must match the redirect_uri registered on the FacileThings client, exactly.
var PAGE_URL = 'https://arwalk.github.io/pebble-facilethings-capture/';

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

// Tells the page whether to offer Connect or Disconnect. No token is passed.
function open_page() {
  var cfg = get();
  var connected = !!(cfg && cfg.refresh_token);

  Pebble.openURL(PAGE_URL + (connected ? '?connected=1' : ''));
}

// Parsed, not acted on: index.js decides whether this is a sign in or a
// disconnect. Returns null when there is nothing usable.
function read_webview(response) {
  if (!response) return null;

  try {
    return JSON.parse(decodeURIComponent(response));
  } catch (e) {
    console.log('config: unreadable response');
    return null;
  }
}

function save(data) {
  if (!data.client_id || !data.refresh_token) {
    console.log('config: incomplete, not saved');
    return;
  }

  put({
    client_id: data.client_id,
    refresh_token: data.refresh_token,
    access_token: data.access_token,
    expires_at: data.expires_at
  });

  console.log('config: saved');
}

// Forgets the account: tokens and the captured-id history alike.
function clear() {
  localStorage.removeItem(KEY_CONFIG);
  localStorage.removeItem(KEY_SEEN);

  console.log('config: cleared');
}

module.exports = {
  get: get,
  update: update,
  seen: seen,
  remember: remember,
  open_page: open_page,
  read_webview: read_webview,
  save: save,
  clear: clear,
  PAGE_URL: PAGE_URL
};
