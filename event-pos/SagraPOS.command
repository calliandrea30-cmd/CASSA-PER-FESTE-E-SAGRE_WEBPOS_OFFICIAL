#!/bin/bash
# ╔══════════════════════════════════════════════════════════════════════╗
# ║         SagraPOS LAUNCHER — Apri con doppio clic su Mac            ║
# ╚══════════════════════════════════════════════════════════════════════╝
# Questo file apre l'applicazione SagraPOS Launcher
# Prima installazione: esegui una volta e segui il wizard

cd "$(dirname "$0")"
PROJ="$(pwd)"
LAUNCHER_DIR="$PROJ/apps/launcher"

# ── Avvia Electron se disponibile, altrimenti avvia direttamente SagraPOS ────
if [ -d "$LAUNCHER_DIR/node_modules/electron" ]; then
  echo "🚀 Avvio SagraPOS Launcher..."
  cd "$LAUNCHER_DIR" || exit 1
  npx electron . 2>/dev/null
  if [ $? -eq 0 ]; then
    exit 0
  fi
  cd "$PROJ" || exit 1
fi

# Fallback: avvia il launcher universale nativo
exec ./SagraPOS.sh "$@"

