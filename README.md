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
tools/ft_auth.py    one-shot sign in, prints a refresh token
```

## Setup

FacileThings v2 has no static API key. It grants only `authorization_code` and
`refresh_token`, with PKCE S256. The app is distributed, so it uses a **public**
client: there is no client secret, and PKCE is what replaces it.

1. Ask FacileThings for a public PKCE client (`token_endpoint_auth_method: none`)
   with redirect URI `https://arwalk.github.io/pebble-facilethings-capture/` and
   scope `user`. They set the redirect URI; `/oauth/applications` is 403 and there
   is no developer dashboard, so it cannot be changed later without asking.
2. Put the client id in `CLIENT_ID` at the top of `docs/index.html`.
3. Publish `docs/` with GitHub Pages (Settings > Pages > branch, folder `/docs`).
   The URL must match `PAGE_URL` in `capture/src/pkjs/config.js` and the
   registered redirect URI, exactly.
4. On the phone: app settings > **Connect FacileThings** > sign in. That is the
   whole setup for a user.

Tokens live in phone localStorage and never reach the watch. Nothing is typed by
hand and no secret exists to leak.

To check which redirect URI a client actually accepts:

```
python3 tools/ft_auth.py --client-id <ID> --probe
```

Open each printed URL directly; the one that reaches a consent screen is the
registered one. `/oauth/login` on its own has no pending request and fails with
`missing_param`.

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
