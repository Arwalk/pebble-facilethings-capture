#include "capture.h"
#include "ui.h"

static void init(void) {
  ui_push();
  capture_init(ui_show);
  capture_start(Confirmation_On);
}

static void deinit(void) {
  capture_deinit();
  ui_pop();
}

int main(void) {
  init();
  app_event_loop();
  deinit();
  return 0;
}
