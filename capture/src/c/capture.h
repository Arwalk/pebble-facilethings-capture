#pragma once

#include <pebble.h>

typedef enum {
  Confirmation_On,
  Confirmation_Off,
} Confirmation;

typedef enum {
  ErrorDialogs_On,
  ErrorDialogs_Off,
} ErrorDialogs;

// What the user is shown. Every failure has its own state so the messages stay distinct.
typedef enum {
  CaptureState_Listening,
  CaptureState_Sending,
  CaptureState_Captured,
  CaptureState_Queued,
  CaptureState_QueueFull,
  CaptureState_NoPhone,
  CaptureState_NoSpeech,
  CaptureState_VoiceDisabled,
  CaptureState_DictationError,
  CaptureState_Transport,
  CaptureState_Auth,
  CaptureState_Api,
  CaptureState_NotConfigured,
} CaptureState;

typedef void (*CaptureStateHandler)(CaptureState state);

// The handler is called on every state change. capture never draws.
void capture_init(CaptureStateHandler on_state);
void capture_deinit(void);

void capture_start(Confirmation confirmation);
