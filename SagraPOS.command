#!/bin/bash
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [ -d "$SCRIPT_DIR/event-pos" ]; then
  cd "$SCRIPT_DIR/event-pos" && bash ./SagraPOS.command "$@"
else
  cd "$SCRIPT_DIR" && bash ./SagraPOS.command "$@"
fi
