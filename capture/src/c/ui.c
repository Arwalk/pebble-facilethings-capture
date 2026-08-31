#include "ui.h"

#define EXIT_DELAY_MS 1800
#define TEXT_HEIGHT 60

typedef enum {
  Vibe_None,
  Vibe_Short,
  Vibe_Double,
} Vibe;

typedef struct {
  const char *text;
  Vibe vibe;
  bool terminal;
} Screen;

static Window *s_window;
static TextLayer *s_text;
static AppTimer *s_exit;

static Screen screen_for(CaptureState state) {
  switch (state) {
    case CaptureState_Listening:      return (Screen){ "Listening", Vibe_None, false };
    case CaptureState_Sending:        return (Screen){ "Sending", Vibe_None, false };
    case CaptureState_Captured:       return (Screen){ "Captured", Vibe_Short, true };
    case CaptureState_Queued:         return (Screen){ "Queued", Vibe_Short, true };
    case CaptureState_QueueFull:      return (Screen){ "Queue full", Vibe_Double, true };
    case CaptureState_NoPhone:        return (Screen){ "No phone", Vibe_Double, true };
    case CaptureState_NoSpeech:       return (Screen){ "No speech", Vibe_Double, true };
    case CaptureState_VoiceDisabled:  return (Screen){ "Voice off", Vibe_Double, true };
    case CaptureState_DictationError: return (Screen){ "Dictation failed", Vibe_Double, true };
    case CaptureState_Transport:      return (Screen){ "No network", Vibe_Double, true };
    case CaptureState_Auth:           return (Screen){ "Auth error", Vibe_Double, true };
    case CaptureState_Api:            return (Screen){ "API error", Vibe_Double, true };
    case CaptureState_NotConfigured:  return (Screen){ "Not set up", Vibe_Double, true };
  }

  return (Screen){ "Error", Vibe_Double, true };
}

static void vibe(Vibe v) {
  if (v == Vibe_Short) vibes_short_pulse();
  if (v == Vibe_Double) vibes_double_pulse();
}

static void on_exit(void *context) {
  s_exit = NULL;
  window_stack_pop_all(false);
}

static void window_load(Window *window) {
  Layer *root = window_get_root_layer(window);
  GRect bounds = layer_get_bounds(root);
  GRect frame = GRect(0, (bounds.size.h - TEXT_HEIGHT) / 2, bounds.size.w, TEXT_HEIGHT);

  s_text = text_layer_create(frame);
  text_layer_set_font(s_text, fonts_get_system_font(FONT_KEY_GOTHIC_28_BOLD));
  text_layer_set_text_alignment(s_text, GTextAlignmentCenter);
  text_layer_set_overflow_mode(s_text, GTextOverflowModeWordWrap);
  text_layer_set_background_color(s_text, GColorClear);
  text_layer_set_text_color(s_text, GColorWhite);

  layer_add_child(root, text_layer_get_layer(s_text));
}

static void window_unload(Window *window) {
  text_layer_destroy(s_text);
  s_text = NULL;
}

void ui_push(void) {
  s_window = window_create();
  window_set_background_color(s_window, GColorBlack);
  window_set_window_handlers(s_window, (WindowHandlers){
    .load = window_load,
    .unload = window_unload,
  });

  window_stack_push(s_window, true);
}

void ui_pop(void) {
  if (s_exit) {
    app_timer_cancel(s_exit);
    s_exit = NULL;
  }

  window_destroy(s_window);
  s_window = NULL;
}

void ui_show(CaptureState state) {
  Screen screen = screen_for(state);

  if (s_text) text_layer_set_text(s_text, screen.text);
  vibe(screen.vibe);

  if (!screen.terminal) return;
  if (s_exit) return;

  s_exit = app_timer_register(EXIT_DELAY_MS, on_exit, NULL);
}
