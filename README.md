# pebble-facilethings-capture

Voice capture on a Pebble Time 2 (emery) into the FacileThings GTD inbox.
Speak, and the sentence lands in the inbox. No Android app, no relay: the HTTPS
call is made by PebbleKit JS on the phone.

## Layout

```
capture/            watchapp
  src/c/            ui -> capture -> msg (AppMessage driver)
  src/pkjs/         index -> ft_client -> {http, config}
  test/run.js       pkjs tests against stubbed XHR/localStorage/Pebble
docs/index.html     hosted OAuth config page (GitHub Pages)
```

## Setup

FacileThings v2 has no static API key. It supports `authorization_code` and
`refresh_token` only, with PKCE S256. The config page runs that flow once and
stores the result on the phone.

1. Publish `docs/` with GitHub Pages.
2. Register that exact page URL as a `redirect_uri` on your FacileThings OAuth
   client. Doorkeeper matches it exactly. The page prints the URI it needs.
3. Set `PAGE_URL` in `capture/src/pkjs/config.js` to the same URL.
4. On the phone, open the app's settings, enter client id and secret, and
   authorize. Tokens are stored on the phone and never reach the watch.

## Build

```
uv tool install pebble-tool
pebble sdk install latest
cd capture && pebble build
node test/run.js
```

## Behaviour

Launch starts dictation at once. On success the item is written to watch persist
storage, then sent. It leaves the queue only on a confirmed 201, so a capture
survives a dead phone, a flat network, or the app being killed mid-send. The
queue is flushed on every launch and whenever the phone side reports ready.

The watch holds the only queue. The phone side keeps none, and re-acks an id it
has already captured, so a lost ack cannot become a duplicate inbox item.

Screens: Listening, Sending, Captured, Queued, Queue full, No phone, No speech,
Voice off, Dictation failed, No network, Auth error, API error, Not set up.

## Limits

- A queued item is truncated to 251 characters (`PERSIST_DATA_MAX_LENGTH` is 256).
- The queue holds 8 items.
