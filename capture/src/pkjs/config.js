// Credential store and config page wiring. Owns localStorage; no HTTP, no
// dictation knowledge. The credential is never logged.

// Must match a redirect_uri registered on the FacileThings OAuth client, exactly.
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

function open_page() {
  Pebble.openURL(PAGE_URL);
}

// The config page hands back the whole credential set through the close URL.
function save_from_webview(response) {
  if (!response) return;

  var data;
  try {
    data = JSON.parse(decodeURIComponent(response));
  } catch (e) {
    console.log('config: unreadable response');
    return;
  }

  if (!data.refresh_token || !data.client_id) {
    console.log('config: incomplete, not saved');
    return;
  }

  put(data);
  console.log('config: saved');
}

module.exports = {
  get: get,
  update: update,
  seen: seen,
  remember: remember,
  open_page: open_page,
  save_from_webview: save_from_webview,
  PAGE_URL: PAGE_URL
};
