// FacileThings client. Turns a captured item into a request and a result kind.
// Talks only to the http and config drivers.

var http = require('./http');
var config = require('./config');

var BASE = 'https://api2.facilethings.com';
var CAPTURE_PATH = '/v2/stuff';
var TOKEN_PATH = '/oauth/token';
var REVOKE_PATH = '/oauth/revoke';

// Refresh a little early so a request never rides an expiring token.
var EXPIRY_SKEW_MS = 60000;

// Result kinds. null means success.
var Kind_Transport = 'transport';
var Kind_Auth = 'auth';
var Kind_Api = 'api';
var Kind_NoConfig = 'noconfig';

function refresh(cfg, cb) {
  var params = {
    grant_type: 'refresh_token',
    refresh_token: cfg.refresh_token,
    client_id: cfg.client_id
  };

  // Confidential client: Doorkeeper wants client_secret_post on every token call.
  if (cfg.client_secret) params.client_secret = cfg.client_secret;

  http.post_form(BASE + TOKEN_PATH, params, function(err, res) {
    if (err) return cb(Kind_Transport);
    if (res.status === http.HTTP_UNAUTHORIZED || res.status === http.HTTP_FORBIDDEN) return cb(Kind_Auth);
    if (res.status !== http.HTTP_OK || !res.body || !res.body.access_token) return cb(Kind_Api);

    var patch = {
      access_token: res.body.access_token,
      expires_at: Date.now() + (res.body.expires_in || 0) * 1000
    };

    // Doorkeeper may rotate the refresh token. Persist the replacement before
    // anything else, or the credential is lost and the owner must authorize again.
    if (res.body.refresh_token) patch.refresh_token = res.body.refresh_token;
    config.update(patch);

    cb(null, res.body.access_token);
  });
}

function token(cb) {
  var cfg = config.get();
  if (!cfg || !cfg.client_id || !cfg.refresh_token) return cb(Kind_NoConfig);

  if (cfg.access_token && cfg.expires_at - EXPIRY_SKEW_MS > Date.now()) {
    return cb(null, cfg.access_token);
  }

  refresh(cfg, cb);
}

function post(text, access, cb) {
  http.post_json(BASE + CAPTURE_PATH, { Authorization: 'Bearer ' + access }, { text: text },
    function(err, res) {
      if (err) return cb(Kind_Transport);
      if (res.status === http.HTTP_CREATED || res.status === http.HTTP_OK) return cb(null);
      if (res.status === http.HTTP_UNAUTHORIZED || res.status === http.HTTP_FORBIDDEN) return cb(Kind_Auth);

      cb(Kind_Api);
    });
}

function attempt(text, retry_on_auth, cb) {
  token(function(kind, access) {
    if (kind) return cb(kind);

    post(text, access, function(post_kind) {
      // A rejected token that looked fresh: drop it, refresh once, try again.
      if (post_kind === Kind_Auth && retry_on_auth) {
        config.update({ access_token: null, expires_at: 0 });
        return attempt(text, false, cb);
      }

      cb(post_kind);
    });
  });
}

// cb(kind) with kind null on success.
function capture(text, cb) {
  attempt(text, true, cb);
}

// Revoking the refresh token drops the whole grant server side. The local copy
// is forgotten either way: the user asked to disconnect, so the app must not
// keep capturing to their account even if the revoke call could not be made.
function disconnect(cb) {
  var cfg = config.get();

  if (!cfg || !cfg.refresh_token) {
    config.clear();
    return cb(null);
  }

  var params = { token: cfg.refresh_token, token_type_hint: 'refresh_token', client_id: cfg.client_id };
  if (cfg.client_secret) params.client_secret = cfg.client_secret;

  http.post_form(BASE + REVOKE_PATH, params, function(err, res) {
    config.clear();

    if (err) return cb(Kind_Transport);
    if (res.status !== http.HTTP_OK) return cb(Kind_Api);

    cb(null);
  });
}

module.exports = {
  capture: capture,
  disconnect: disconnect,
  Kind_Transport: Kind_Transport,
  Kind_Auth: Kind_Auth,
  Kind_Api: Kind_Api,
  Kind_NoConfig: Kind_NoConfig
};
