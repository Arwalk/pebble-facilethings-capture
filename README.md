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

FacileThings v2 has no static API key. A personal-use client authenticates with
the password grant, which needs no redirect URI and nothing hosted.

1. Get a refresh token, once, on your computer:

   ```
   python3 tools/ft_auth.py --client-id <ID> --client-secret <SECRET> --password
   ```

   It asks for your FacileThings email and password, uses them for that one
   request, and prints a refresh token.

2. On the phone, open the app's settings and enter the client id, the client
   secret and the refresh token. A blank field keeps what is already stored, so
   the secret is typed once.

Your password is never stored. The three saved values live in phone
localStorage and never reach the watch.

`/.well-known/oauth-authorization-server` advertises only `authorization_code`
and `refresh_token`, but the password grant is accepted: an unsupported grant is
rejected as `unsupported_grant_type`, while `password` gets as far as client
authentication.

If you ever need a PKCE client instead (only if other people sign in with their
own accounts), `ft_auth.py --probe` prints authorize URLs to find which redirect
URI is registered, and `--oob` completes that flow by hand.

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
