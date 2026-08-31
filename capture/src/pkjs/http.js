// HTTP driver. XMLHttpRequest mechanics only; no FacileThings knowledge.

var TIMEOUT_MS = 15000;

var HTTP_OK = 200;
var HTTP_CREATED = 201;
var HTTP_UNAUTHORIZED = 401;
var HTTP_FORBIDDEN = 403;

// cb(err, res). err is set only when no status came back at all (offline, DNS,
// timeout). res is { status: number, body: object|null }.
function send(method, url, headers, content_type, payload, cb) {
  var xhr = new XMLHttpRequest();
  var done = false;

  function finish(err, res) {
    if (done) return;

    done = true;
    cb(err, res);
  }

  xhr.open(method, url, true);
  xhr.timeout = TIMEOUT_MS;

  if (content_type) xhr.setRequestHeader('Content-Type', content_type);
  Object.keys(headers || {}).forEach(function(name) {
    xhr.setRequestHeader(name, headers[name]);
  });

  xhr.onload = function() {
    var body = null;
    try {
      body = JSON.parse(xhr.responseText);
    } catch (e) {
      body = null;
    }

    finish(null, { status: xhr.status, body: body });
  };

  xhr.onerror = function() { finish(new Error('network')); };
  xhr.ontimeout = function() { finish(new Error('timeout')); };

  xhr.send(payload);
}

function post_json(url, headers, obj, cb) {
  send('POST', url, headers, 'application/json', JSON.stringify(obj), cb);
}

function post_form(url, params, cb) {
  var body = Object.keys(params).map(function(name) {
    return encodeURIComponent(name) + '=' + encodeURIComponent(params[name]);
  }).join('&');

  send('POST', url, null, 'application/x-www-form-urlencoded', body, cb);
}

module.exports = {
  post_json: post_json,
  post_form: post_form,
  HTTP_OK: HTTP_OK,
  HTTP_CREATED: HTTP_CREATED,
  HTTP_UNAUTHORIZED: HTTP_UNAUTHORIZED,
  HTTP_FORBIDDEN: HTTP_FORBIDDEN
};
