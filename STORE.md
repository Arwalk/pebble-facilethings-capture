# Appstore listing

Copy for the Pebble appstore entry. Kept here so it stays in step with the app.

## Name

FT Capture

## Summary

Speak a thought, and it lands in your FacileThings inbox.

## Description

Open the app, say the thing you do not want to forget, and it goes straight to
the inbox of your FacileThings account. Nothing to type, no menus to walk
through. Assign it to a quick launch button and a capture takes a few seconds
from raising your wrist.

**Using it**

Launch the app and it starts listening at once. Speak, confirm the
transcription, and the screen tells you what happened: *Captured* when
FacileThings has the item, *Queued* when it could not be sent yet. The app then
exits on its own.

Out of Bluetooth range, or the phone has no signal? The capture is saved on the
watch and sent by itself next time the app runs with a working connection. It is
kept until FacileThings confirms it, so a capture is not lost to a flat network.
Up to 8 captures can wait this way.

**Setting it up**

Open the app's settings in the Pebble phone app and press *Connect
FacileThings*. You sign in on the FacileThings site itself, so this app never
sees your password. That is the whole setup.

To sign out, open the settings again and press *Disconnect*.

**What is stored, and where**

Your notes go to FacileThings and nowhere else. There is no server belonging to
this app, no analytics, and no account to create.

- *On your phone*: the sign-in tokens FacileThings issued, so you do not have to
  sign in again. Also a short list of the last 20 captures the app confirmed as
  sent, kept so a dropped connection cannot file the same note twice. That list
  holds a counter and a checksum of the text, not the text itself.
- *On your watch*: a counter for numbering captures, and any capture still
  waiting to be sent. A waiting capture is erased as soon as FacileThings
  confirms it.
- *During sign-in*: the browser page holds a one-time proof of the sign-in
  request until it completes, then discards it.

*Disconnect* revokes the tokens at FacileThings and erases all of the above from
your phone. Removing the app from your watch erases the watch side.

No identifier for you, your watch, or your phone is created or transmitted. Only
the text you dictate is sent to FacileThings, over HTTPS.

Speech recognition is done by the Pebble platform, as it is for every dictation
on the watch. This app receives the finished text.

**Requires**

A FacileThings account, and a watch with dictation (Pebble Time 2).

## Support

https://github.com/Arwalk/pebble-facilethings-capture
