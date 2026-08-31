#include "msg.h"

#define INBOX_SIZE 128
#define OUTBOX_SIZE 512

static MsgHandlers s_handlers;

static void inbox_received(DictionaryIterator *iter, void *context) {
  if (dict_find(iter, MESSAGE_KEY_Ready)) {
    if (s_handlers.ready) s_handlers.ready();
    return;
  }

  Tuple *id_t = dict_find(iter, MESSAGE_KEY_Id);
  if (!id_t) return;

  uint32_t id = (uint32_t)id_t->value->int32;

  if (dict_find(iter, MESSAGE_KEY_Ack)) {
    if (s_handlers.ack) s_handlers.ack(id);
    return;
  }

  Tuple *err_t = dict_find(iter, MESSAGE_KEY_Err);
  if (!err_t) return;

  if (s_handlers.err) s_handlers.err(id, (MsgErr)err_t->value->int32);
}

static void outbox_failed(DictionaryIterator *iter, AppMessageResult reason, void *context) {
  Tuple *id_t = dict_find(iter, MESSAGE_KEY_Id);
  uint32_t id = id_t ? (uint32_t)id_t->value->int32 : 0;

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
