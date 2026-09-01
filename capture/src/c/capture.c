#include "capture.h"
#include "msg.h"

// Dictation lifecycle plus the offline queue.
//
// Every capture is written to persist storage BEFORE it is sent, so a capture
// survives the app dying mid-send. The queue is the single source of truth; the
// phone side keeps none. An item leaves the queue only on a confirmed ack.
//
//   dictation ok --> q_push --> flush --> msg_send_item --+--> ack --> q_pop
//                                                          |
//                                            err/timeout --+--> stays queued,
//                                                               retried next launch

#define DICT_BUF_SIZE 512
#define QUEUE_MAX 8
#define QUEUE_TEXT_SIZE 252    // QueueItem must fit PERSIST_DATA_MAX_LENGTH (256)
#define SEND_TIMEOUT_MS 10000

// The phone side may not be up yet when the app launches, so a send that never
// leaves the watch is retried before the capture is called queued.
#define SEND_ATTEMPTS 3
#define RETRY_MS 1000

// The app has its own screen for every failure, so the firmware dialogs would
// duplicate them and add a tap before the app can exit.
#define ERROR_DIALOGS ErrorDialogs_Off

#define PERSIST_KEY_NEXT_ID 1
#define PERSIST_KEY_COUNT 2
#define PERSIST_KEY_ITEM_BASE 16

typedef struct {
  uint32_t id;
  char text[QUEUE_TEXT_SIZE];
} QueueItem;

static DictationSession *s_session;
static CaptureStateHandler s_on_state;
static AppTimer *s_timeout;

static uint32_t s_inflight_id;   // item currently awaiting an ack, 0 when idle
static uint32_t s_launch_id;     // item dictated this launch, so its ack means "Captured"
static int s_attempts;           // consecutive failed sends of the head item

static void flush(void);

static void state(CaptureState s) {
  if (s_on_state) s_on_state(s);
}

// Outcome of a send. Older queued items are flushed in the background on every
// launch, so they must not overwrite the message for this launch's dictation.
static void report(CaptureState s) {
  if (s_launch_id == 0) return;

  state(s);
}

// -- queue ------------------------------------------------------------------

static int q_count(void) {
  return persist_exists(PERSIST_KEY_COUNT) ? persist_read_int(PERSIST_KEY_COUNT) : 0;
}

static bool q_get(int slot, QueueItem *item) {
  return persist_read_data(PERSIST_KEY_ITEM_BASE + slot, item, sizeof(*item)) == (int)sizeof(*item);
}

// Seeded from the clock, not from 1: removing the app wipes persist, and the
// phone remembers the captures it already sent. Restarting the count would hand
// a new capture an id the phone still holds.
static uint32_t next_id(void) {
  uint32_t id = persist_exists(PERSIST_KEY_NEXT_ID) ? (uint32_t)persist_read_int(PERSIST_KEY_NEXT_ID)
                                                    : (uint32_t)time(NULL);

  persist_write_int(PERSIST_KEY_NEXT_ID, (int32_t)(id + 1));
  return id;
}

// Returns the new item's id, or 0 when the queue is full.
static uint32_t q_push(const char *text) {
  int n = q_count();
  if (n >= QUEUE_MAX) return 0;

  QueueItem item = { .id = next_id() };
  strncpy(item.text, text, QUEUE_TEXT_SIZE - 1);
  item.text[QUEUE_TEXT_SIZE - 1] = '\0';

  // Counting an item that was not written would report it queued and then drop
  // it silently on the next flush.
  if (persist_write_data(PERSIST_KEY_ITEM_BASE + n, &item, sizeof(item)) != (int)sizeof(item)) return 0;

  persist_write_int(PERSIST_KEY_COUNT, n + 1);
  return item.id;
}

// Drop the head and shift the rest down.
static void q_pop(void) {
  int n = q_count();
  if (n <= 0) return;

  for (int i = 1; i < n; i++) {
    QueueItem item;
    if (!q_get(i, &item)) continue;

    persist_write_data(PERSIST_KEY_ITEM_BASE + i - 1, &item, sizeof(item));
  }

  persist_delete(PERSIST_KEY_ITEM_BASE + n - 1);
  persist_write_int(PERSIST_KEY_COUNT, n - 1);
}

// -- sending ----------------------------------------------------------------

static void cancel_timeout(void) {
  if (!s_timeout) return;

  app_timer_cancel(s_timeout);
  s_timeout = NULL;
}

// The phone acknowledged nothing in time. It may still have posted, so the item
// stays queued and the id guards against a second capture.
static void on_timeout(void *context) {
  s_timeout = NULL;
  s_inflight_id = 0;
  report(CaptureState_Queued);
}

static void on_retry(void *context) {
  s_timeout = NULL;
  flush();
}

// The send never left the watch. Retry a few times before giving up.
static void retry_or_queue(void) {
  cancel_timeout();
  s_inflight_id = 0;

  if (s_attempts >= SEND_ATTEMPTS) {
    report(CaptureState_Queued);
    return;
  }

  s_timeout = app_timer_register(RETRY_MS, on_retry, NULL);
}

static void flush(void) {
  if (s_inflight_id != 0) return;
  if (q_count() == 0) return;

  QueueItem item;
  if (!q_get(0, &item)) {
    q_pop();       // unreadable slot, drop it rather than wedge the queue
    flush();
    return;
  }

  s_attempts++;
  APP_LOG(APP_LOG_LEVEL_INFO, "send id=%u queued=%d attempt=%d",
          (unsigned int)item.id, q_count(), s_attempts);

  if (!msg_send_item(item.id, item.text)) {
    retry_or_queue();
    return;
  }

  s_inflight_id = item.id;
  s_timeout = app_timer_register(SEND_TIMEOUT_MS, on_timeout, NULL);
}

static CaptureState err_state(MsgErr err) {
  switch (err) {
    case MsgErr_Auth: return CaptureState_Auth;
    case MsgErr_Api: return CaptureState_Api;
    case MsgErr_NoConfig: return CaptureState_NotConfigured;
    default: return CaptureState_Transport;
  }
}

// -- phone side callbacks ---------------------------------------------------

// The phone side is up. Give the head item a fresh set of attempts.
static void on_ready(void) {
  s_attempts = 0;
  cancel_timeout();
  flush();
}

static void on_ack(uint32_t id) {
  if (id != s_inflight_id) return;

  cancel_timeout();
  s_inflight_id = 0;
  s_attempts = 0;
  q_pop();

  if (id == s_launch_id) {
    state(CaptureState_Captured);
    return;
  }

  flush();
}

static void on_err(uint32_t id, MsgErr err) {
  if (id != s_inflight_id) return;

  cancel_timeout();
  s_inflight_id = 0;
  report(err_state(err));   // item stays queued and is retried next launch
}

static void on_send_fail(uint32_t id) {
  retry_or_queue();
}

// -- dictation --------------------------------------------------------------

static CaptureState status_state(DictationSessionStatus status) {
  switch (status) {
    case DictationSessionStatusFailureConnectivityError: return CaptureState_NoPhone;
    case DictationSessionStatusFailureNoSpeechDetected: return CaptureState_NoSpeech;
    case DictationSessionStatusFailureDisabled: return CaptureState_VoiceDisabled;
    default: return CaptureState_DictationError;
  }
}

static void on_dictation(DictationSession *session, DictationSessionStatus status,
                         char *transcription, void *context) {
  APP_LOG(APP_LOG_LEVEL_INFO, "dictation status=%d", (int)status);

  if (status != DictationSessionStatusSuccess) {
    state(status_state(status));
    return;
  }

  // transcription is invalid once this returns; q_push copies it into persist.
  s_launch_id = q_push(transcription);
  if (s_launch_id == 0) {
    state(CaptureState_QueueFull);
    return;
  }

  state(CaptureState_Sending);
  flush();
}

// -- api --------------------------------------------------------------------

void capture_init(CaptureStateHandler on_state) {
  s_on_state = on_state;

  MsgHandlers handlers = {
    .ready = on_ready,
    .ack = on_ack,
    .err = on_err,
    .send_fail = on_send_fail,
  };
  msg_open(handlers);
}

void capture_deinit(void) {
  cancel_timeout();

  if (s_session) {
    dictation_session_destroy(s_session);
    s_session = NULL;
  }

  msg_close();
}

void capture_start(Confirmation confirmation) {
  flush();   // anything left over from a previous launch goes out first

  s_session = dictation_session_create(DICT_BUF_SIZE, on_dictation, NULL);
  if (!s_session) {
    state(CaptureState_NoPhone);   // no phone, no microphone, or internal error
    return;
  }

  dictation_session_enable_confirmation(s_session, confirmation == Confirmation_Off ? false : true);
  dictation_session_enable_error_dialogs(s_session, ERROR_DIALOGS == ErrorDialogs_Off ? false : true);

  state(CaptureState_Listening);
  dictation_session_start(s_session);
}
