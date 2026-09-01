#include "msg.h"

#define INBOX_SIZE 128
#define OUTBOX_SIZE 512

static MsgHandlers s_handlers;

// value->int32 reads four bytes whatever the tuple actually holds, so a shorter
// or non-integer one would be read past its end.
static bool int_value(const Tuple *t, uint32_t *out) {
  if (!t) return false;
  if (t->type != TUPLE_INT && t->type != TUPLE_UINT) return false;

  switch (t->length) {
    case 1: *out = t->value->uint8; return true;
    case 2: *out = t->value->uint16; return true;
    case 4: *out = t->value->uint32; return true;
    default: return false;
  }
}

static void inbox_received(DictionaryIterator *iter, void *context) {
  if (dict_find(iter, MESSAGE_KEY_Ready)) {
    if (s_handlers.ready) s_handlers.ready();
    return;
  }

  uint32_t id;
  if (!int_value(dict_find(iter, MESSAGE_KEY_Id), &id)) return;

  if (dict_find(iter, MESSAGE_KEY_Ack)) {
    if (s_handlers.ack) s_handlers.ack(id);
    return;
  }

  uint32_t err;
  if (!int_value(dict_find(iter, MESSAGE_KEY_Err), &err)) return;

  if (s_handlers.err) s_handlers.err(id, (MsgErr)err);
}

static void outbox_failed(DictionaryIterator *iter, AppMessageResult reason, void *context) {
  uint32_t id;
  if (!int_value(dict_find(iter, MESSAGE_KEY_Id), &id)) id = 0;

  if (s_handlers.send_fail) s_handlers.send_fail(id);
}

void msg_open(MsgHandlers handlers) {
  s_handlers = handlers;

  app_message_register_inbox_received(inbox_received);
  app_message_register_outbox_failed(outbox_failed);
  app_message_open(INBOX_SIZE, OUTBOX_SIZE);
}

void msg_close(void) {
  app_message_deregister_callbacks();
}

bool msg_send_item(uint32_t id, const char *text) {
  DictionaryIterator *out;
  if (app_message_outbox_begin(&out) != APP_MSG_OK) return false;

  dict_write_uint32(out, MESSAGE_KEY_Id, id);
  dict_write_cstring(out, MESSAGE_KEY_Text, text);

  return app_message_outbox_send() == APP_MSG_OK;
}
