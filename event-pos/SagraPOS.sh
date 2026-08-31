#!/bin/bash
# ╔══════════════════════════════════════════════════════════════════════╗
# ║                  🏪 SagraPOS — Launcher Universale                  ║
# ╚══════════════════════════════════════════════════════════════════════╝
# Doppio clic o ./SagraPOS.sh per avviare la Cassa su macOS / Linux

cd "$(dirname "$0")"

echo ""
echo "╔══════════════════════════════════════════════════════════════════╗"
echo "║                   🏪 SagraPOS — AVVIO SISTEMA                   ║"
echo "╚══════════════════════════════════════════════════════════════════╝"
echo ""

# 1. Se esiste configurazione salvata, avvia direttamente
if [ -f "config.local.json" ]; then
  if grep -q '"isServer": false' "config.local.json" 2>/dev/null; then
    echo "ℹ️  Configurazione rilevata: CASSA AGGIUNTIVA (Client)"
    exec ./AVVIA_CASSA_AGGIUNTIVA.sh "$@"
  elif grep -q '"isServer": true' "config.local.json" 2>/dev/null; then
    echo "ℹ️  Configurazione rilevata: CASSA 1 (Server Principale)"
    exec ./AVVIA_CASSA_1_SERVER.sh "$@"
  fi
fi

# 2. Se prima volta, mostra scelta semplice
echo "Scegli la modalità di avvio per questo computer:"
echo ""
echo "  [1] CASSA 1 — SERVER PRINCIPALE (Questo computer fa da server + cassa)"
echo "  [2] CASSA AGGIUNTIVA (Questo computer si collega alla Cassa 1)"
echo ""
echo "(Questa scelta verrà salvata e non dovrai ripeterla ai prossimi avvii)"
echo ""
printf "Digita 1 o 2 e premi Invio [default: 1]: "
read -r SCELTA

if [ "$SCELTA" = "2" ]; then
  echo ""
  echo "🚀 Avvio Cassa Aggiuntiva..."
  exec ./AVVIA_CASSA_AGGIUNTIVA.sh "$@"
else
  echo ""
  echo "🚀 Avvio Cassa 1 (Server Principale)..."
  exec ./AVVIA_CASSA_1_SERVER.sh "$@"
fi
