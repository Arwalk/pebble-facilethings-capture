#pragma once

#include "capture.h"

void ui_push(void);
void ui_pop(void);

// Shows the state, vibes, and exits the app once the state is terminal.
void ui_show(CaptureState state);
