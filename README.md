# FT Capture

Speak a thought into your Pebble, and it lands in your FacileThings inbox.

Open the app, say the thing you do not want to forget, and it is filed. No
typing, no menus. Assign it to a quick launch button and a capture takes a few
seconds from raising your wrist.

Pebble Time 2. Needs a FacileThings account.

## Using it

Launch the app and it starts listening at once. Speak, confirm the
transcription, and the screen tells you what happened:

| Screen | Meaning |
|---|---|
| Listening | speak now |
| Sending | the phone is filing it |
| Captured | FacileThings has it |
| Queued | saved on the watch, it will go out later |
| Queue full | 8 captures are already waiting |
| No phone | the watch cannot reach the phone |
| No speech | nothing was heard |
| Voice off | dictation is disabled on the phone |
| No network | the phone could not reach FacileThings |
| Auth error | sign in again from the settings |
| API error | FacileThings refused the item |
| Not set up | connect an account first |

The app exits on its own after telling you.

**Offline is fine.** Out of range, or no signal? The capture is saved on the
watch and sent by itself next time the app runs with a working connection. It is
kept until FacileThings confirms it, so a capture is not lost to a flat network.
Up to 8 captures can wait, each up to 251 characters.

## Setting it up

Open the app's settings in the Pebble phone app and press **Connect
FacileThings**. You sign in on the FacileThings site itself, so this app never
sees your password. That is the whole setup.

To sign out, open the settings again and press **Disconnect**.

## What is stored, and where

Your notes go to FacileThings and nowhere else. There is no server belonging to
this app, no analytics, and no account to create. No identifier for you, your
watch, or your phone is created or transmitted — only the text you dictate is
sent, over HTTPS.

**On your phone** (browser storage owned by the Pebble app):

- `ft_config` — the tokens FacileThings issued at sign-in, so you are not asked
  again: `client_id`, `access_token`, `refresh_token`, `expires_at`.
- `ft_seen` — the last 20 captures confirmed as filed, so a dropped connection
  cannot file the same note twice. Each entry is a capture number and a checksum
  of the text. **The text itself is not kept.**

**On your watch** (persist storage):

- A counter used to number captures, seeded from the clock.
- Any capture still waiting to be sent, text included. Erased as soon as
  FacileThings confirms it.

**During sign-in** (page session storage, on the phone's browser):

- The one-time PKCE verifier and state for the sign-in in progress. Discarded
  when it completes.

**Disconnect** revokes the tokens at FacileThings and erases both `ft_config`
and `ft_seen`. Removing the app from the watch erases the watch side. The
capture number is local to the watch and is never sent to FacileThings.

Speech recognition is done by the Pebble platform, as for every dictation on the
watch. This app receives the finished text.

---

# Developing

```
capture/            watchapp
  src/c/            ui -> capture -> msg (AppMessage driver)
  src/pkjs/         index -> ft_client -> {http, config}
  test/run.js       pkjs tests against stubbed XHR/localStorage/Pebble
  test/config_page.js  config page tests against a DOM stub
docs/index.html     hosted sign in page (GitHub Pages)
tools/ft_auth.py    one-shot sign in, prints a refresh token
STORE.md            appstore listing copy
```

```
uv tool install pebble-tool
pebble sdk install latest
cd capture && pebble build
node test/run.js
node test/config_page.js
```

## Auth

FacileThings v2 has no static API key. It grants only `authorization_code` and
`refresh_token`, with PKCE S256. The app is distributed, so it uses a **public**
client: there is no client secret, and PKCE is what replaces it.

`CLIENT_ID` and `REDIRECT_URI` in `docs/index.html` hold the issued values;
neither is a secret. Doorkeeper matches `redirect_uri` as a parsed URI, so the
**trailing slash is part of it**; the value is pinned as a constant rather than
read from `location`, which would differ if the page were reached as
`/index.html`. FacileThings sets the redirect URIs: `/oauth/applications` is 403
and there is no developer dashboard, so they cannot be changed without asking.

The sign-in page is published with GitHub Pages (Settings > Pages > branch,
folder `/docs`). Its URL must match `PAGE_URL` in `capture/src/pkjs/config.js`
and the registered redirect URI, exactly.

To check which redirect URI a client actually accepts:

```
python3 tools/ft_auth.py --client-id <ID> --probe
```

Open each printed URL directly; the one that reaches a consent screen is the
registered one. `/oauth/login` on its own has no pending request and fails with
`missing_param`.

## Queue

Every capture is written to watch persist storage before it is sent, and leaves
the queue only on a confirmed 201. The watch holds the only queue; the phone
side keeps none, so an item cannot be filed twice from two places.

A capture is identified by its number **and** a checksum of its text. Watch
persist is wiped when the app is removed, so numbers would otherwise restart and
collide with the ones the phone still remembers, and a new capture would be
acknowledged as a duplicate and silently dropped.

Queued items truncate at 251 characters: `PERSIST_DATA_MAX_LENGTH` is 256 and a
record carries a `uint32` id alongside the text. The live path carries the full
512-byte dictation buffer.
