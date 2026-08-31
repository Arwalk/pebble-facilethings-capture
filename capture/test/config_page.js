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

function load_page() {
  var html = fs.readFileSync(PAGE, 'utf8');
  var script = /<script>([\s\S]*?)<\/script>/.exec(html)[1];

  var app = node('div');
  var sandbox = {
    document: {
      getElementById: function(id) { return id === 'app' ? app : node('input'); },
      createElement: node
    },
    location: { origin: 'https://example.test', pathname: '/p/', search: '',
                replace: function() {}, assign: function() {} },
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

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
