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

1. Publish `docs/` with GitHub Pages (Settings > Pages > branch, folder `/docs`).
   The page is then served at

       https://arwalk.github.io/pebble-facilethings-capture/

2. Register that exact string as a `redirect_uri` on your FacileThings OAuth
   client. Doorkeeper matches it exactly, and the host is lowercase. The page
   also prints the URI it needs, so open it once if in doubt.
3. `PAGE_URL` in `capture/src/pkjs/config.js` already holds that URL. Change it
   only if you host the page elsewhere.
4. On the phone, open the app's settings, enter client id and secret, and
   authorize. Tokens are stored on the phone and never reach the watch.

## Finding the registered redirect URI

FacileThings sets the redirect URI when it issues the client. `/oauth/applications`
is 403 and there is no developer dashboard, so it cannot be changed from here.
To see which one your client accepts:

```
python3 tools/ft_auth.py --client-id <ID> --probe
```

Open each printed URL directly. Each sends you to the sign in page and resumes
after. Do not visit `/oauth/login` on its own; it has no pending request and
fails with `missing_param`. The URL that reaches a consent screen carries the
registered redirect URI; the others report an invalid one.

If it is loopback or out-of-band, skip the hosted page entirely:

```
python3 tools/ft_auth.py --client-id <ID> --client-secret <SECRET>        # loopback
python3 tools/ft_auth.py --client-id <ID> --client-secret <SECRET> --oob  # paste the code
```

Either prints a refresh token for the watchapp settings.

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
