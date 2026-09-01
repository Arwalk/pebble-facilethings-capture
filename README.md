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
  test/config_page.js  config page tests against a DOM stub
docs/index.html     hosted sign in page (GitHub Pages)
tools/ft_auth.py    one-shot sign in, prints a refresh token
```

## Setup

FacileThings v2 has no static API key. It grants only `authorization_code` and
`refresh_token`, with PKCE S256. The app is distributed, so it uses a **public**
client: there is no client secret, and PKCE is what replaces it.

The client is registered. `CLIENT_ID` and `REDIRECT_URI` in `docs/index.html`
hold the issued values; neither is a secret. Doorkeeper compares `redirect_uri`
byte for byte, and the registered value has **no trailing slash**, so it is
pinned as a constant rather than read from `location`. FacileThings sets the
redirect URIs: `/oauth/applications` is 403 and there is no developer dashboard,
so they cannot be changed without asking.

1. Publish `docs/` with GitHub Pages (Settings > Pages > branch, folder `/docs`).
2. On the phone: app settings > **Connect FacileThings** > sign in. That is the
   whole setup for a user.

To sign out, open the settings again and press **Disconnect**. It revokes the
refresh token at `/oauth/revoke` and forgets the account, including the
captured-id history. The local copy is dropped even if the revoke call fails, so
a disconnect is never left half done.

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
node test/config_page.js
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
