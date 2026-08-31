// Runs the config page's script against a minimal DOM.
//
// The page receives error text from the query string and from the token
// endpoint, and it holds the PKCE verifier and the user's tokens, so anything
// injected there runs with access to both.

var assert = require('assert');
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var PAGE = path.join(__dirname, '..', '..', 'docs', 'index.html');

function node(tag) {
  return {
    tagName: tag,
    className: '',
    children: [],
    text: '',
    html: null,
    get textContent() { return this.text; },
    set textContent(v) { this.text = String(v); this.children = []; },
    get innerHTML() { return this.html; },
    set innerHTML(v) { this.html = String(v); },
    appendChild: function(child) { this.children.push(child); return child; }
  };
}

function walk(root, seen) {
  seen = seen || { tags: [], text: [], html: [] };
  seen.tags.push(root.tagName);

  if (root.text) seen.text.push(root.text);
  if (root.html) seen.html.push(root.html);

  root.children.forEach(function(c) { walk(c, seen); });
  return seen;
}

function load_page(search) {
  var html = fs.readFileSync(PAGE, 'utf8');
  var script = /<script>([\s\S]*?)<\/script>/.exec(html)[1];

  var app = node('div');
  var sandbox = {
    document: {
      getElementById: function(id) { return id === 'app' ? app : node('input'); },
      createElement: node
    },
    location: { origin: 'https://example.test', pathname: '/p/', search: search || '',
                replace: function(u) { sandbox.replaced = u; }, assign: function() {} },
    sessionStorage: { getItem: function() { return null; }, setItem: function() {},
                      removeItem: function() {} },
    crypto: { getRandomValues: function(a) { return a; },
              subtle: { digest: function() { return Promise.resolve(new ArrayBuffer(32)); } } },
    fetch: function() { return new Promise(function() {}); },
    btoa: function(s) { return Buffer.from(s, 'binary').toString('base64'); },
    TextEncoder: TextEncoder,
    URLSearchParams: URLSearchParams,
    Date: Date,
    Promise: Promise,
    console: { log: function() {} }
  };

  vm.createContext(sandbox);
  vm.runInContext(script, sandbox);

  return { sandbox: sandbox, app: app };
}

var passed = 0, failed = 0;

function test(name, fn) {
  try {
    fn(); passed++; console.log('  ok   ' + name);
  } catch (e) {
    failed++; console.log('  FAIL ' + name + '\n       ' + e.message);
  }
}

var PAYLOAD = '<img src=x onerror=steal(document.domain)>';

test('error detail from the query string cannot inject markup', function() {
  var page = load_page();
  page.sandbox.show_error('Authorization was refused.', PAYLOAD);

  var seen = walk(page.app);

  assert.ok(!seen.tags.some(function(t) { return /^img$/i.test(t); }),
            'payload became a real element: ' + seen.tags.join(','));
  assert.deepStrictEqual(seen.html, [], 'no untrusted value may go through innerHTML');
  assert.ok(seen.text.indexOf(PAYLOAD) !== -1, 'detail should still be shown, as text');
});

test('the page never concatenates a detail into an HTML string', function() {
  var src = fs.readFileSync(PAGE, 'utf8');
  var script = /<script>([\s\S]*?)<\/script>/.exec(src)[1];

  script.split('\n').forEach(function(line, i) {
    if (line.indexOf('innerHTML') === -1) return;
    if (line.trim().indexOf('//') === 0) return;

    assert.ok(line.indexOf('+') === -1 || /'[^']*'\s*$/.test(line.trim()),
              'line ' + (i + 1) + ' builds innerHTML by concatenation: ' + line.trim());
  });
});

function find_button(root, label) {
  if (root.tagName === 'button' && root.text === label) return root;

  for (var i = 0; i < root.children.length; i++) {
    var hit = find_button(root.children[i], label);
    if (hit) return hit;
  }

  return null;
}

// The page refuses to start while CLIENT_ID is the placeholder, so give it one
// and render again.
function rendered(search) {
  var page = load_page(search);

  page.sandbox.CLIENT_ID = 'test-client-id';
  page.sandbox.show_start();

  return page;
}

test('the placeholder client id stops the flow', function() {
  var page = load_page('');

  assert.ok(!find_button(page.app, 'Connect FacileThings'),
            'must not offer sign in before a client id is set');
  assert.ok(walk(page.app).text.join(' ').indexOf('client id') !== -1,
            'should say what is missing');
});

test('a connected page offers Disconnect and reports only the intent', function() {
  var page = rendered('?connected=1');

  var out = find_button(page.app, 'Disconnect');
  assert.ok(out, 'Disconnect button should be shown when connected=1');

  out.onclick();

  var url = page.sandbox.replaced;
  assert.ok(/^pebblejs:\/\/close#/.test(url), 'must close back into the app: ' + url);

  var data = JSON.parse(decodeURIComponent(url.replace('pebblejs://close#', '')));
  assert.strictEqual(data.disconnect, true);
  assert.deepStrictEqual(Object.keys(data), ['disconnect'], 'must carry nothing else');
});

test('a fresh page offers Connect, not Disconnect', function() {
  var page = rendered('');

  assert.ok(find_button(page.app, 'Connect FacileThings'), 'Connect should be shown');
  assert.ok(!find_button(page.app, 'Disconnect'), 'Disconnect must not be shown');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
