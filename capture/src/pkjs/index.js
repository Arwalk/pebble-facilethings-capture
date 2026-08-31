// Message handler. Wire format on one side, ft_client on the other.

var ft = require('./ft_client');
var config = require('./config');

// Mirrored by MsgErr in src/c/msg.h.
var Err_Transport = 1;
var Err_Auth = 2;
var Err_Api = 3;
var Err_NoConfig = 4;

var ERR_CODE = {};
ERR_CODE[ft.Kind_Transport] = Err_Transport;
ERR_CODE[ft.Kind_Auth] = Err_Auth;
ERR_CODE[ft.Kind_Api] = Err_Api;
ERR_CODE[ft.Kind_NoConfig] = Err_NoConfig;

function ack(id) {
  Pebble.sendAppMessage({ Id: id, Ack: 1 });
}

function fail(id, kind) {
  Pebble.sendAppMessage({ Id: id, Err: ERR_CODE[kind] || Err_Api });
}

Pebble.addEventListener('ready', function() {
  Pebble.sendAppMessage({ Ready: 1 });
});

Pebble.addEventListener('appmessage', function(e) {
  var id = e.payload.Id;
  var text = e.payload.Text;

  if (id === undefined || text === undefined) return;

  // Its ack was lost, not its capture. Re-ack instead of capturing twice.
  if (config.seen(id)) return ack(id);

  console.log('POST /v2/stuff id=' + id);

  ft.capture(text, function(kind) {
    if (kind) return fail(id, kind);

    config.remember(id);
    ack(id);
  });
});

Pebble.addEventListener('showConfiguration', function() {
  config.open_page();
});

Pebble.addEventListener('webviewclosed', function(e) {
  config.save_from_webview(e.response);
});
