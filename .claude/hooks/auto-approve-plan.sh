#!/usr/bin/env bash
# Auto-approve ExitPlanMode so the interactive picker never appears.
# After approval, Claude returns to the defaultMode (acceptEdits).
echo '{"decision":"approve"}'
