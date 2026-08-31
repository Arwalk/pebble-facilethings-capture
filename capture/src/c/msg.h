#pragma once

#include <pebble.h>

// AppMessage driver. Raw plumbing only; no capture or UI knowledge.
// The Err* codes are mirrored in src/pkjs/index.js.
typedef enum {
  MsgErr_None = 0,
  MsgErr_Transport = 1,
  MsgErr_Auth = 2,
  MsgErr_Api = 3,
  MsgErr_NoConfig = 4,
} MsgErr;

typedef struct {
  void (*ready)(void);
  void (*ack)(uint32_t id);
  void (*err)(uint32_t id, MsgErr err);
  void (*send_fail)(uint32_t id);
} MsgHandlers;

void msg_open(MsgHandlers handlers);
void msg_close(void);

// False when the message could not be queued for sending.
bool msg_send_item(uint32_t id, const char *text);
