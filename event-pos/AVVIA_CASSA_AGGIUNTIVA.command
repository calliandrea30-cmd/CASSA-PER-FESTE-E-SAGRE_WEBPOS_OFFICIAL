#!/bin/bash
# ╔══════════════════════════════════════════════════════════════════════════╗
# ║         SAGRA POS — AVVIA CASSA AGGIUNTIVA (CLIENT)                     ║
# ║         macOS .command — doppio clic per avviare                         ║
# ║                                                                          ║
# ║  Per cambiare il server: cancella config.local.json e riavvia            ║
# ╚══════════════════════════════════════════════════════════════════════════╝

cd "$(dirname "$0")"
PROJECT_ROOT="$(pwd)"
CONFIG_FILE="$PROJECT_ROOT/config.local.json"
AGENT_PID=""

# ── Cleanup ───────────────────────────────────────────────────────────────────
cleanup() {
  echo ""
  echo "🛑 Arresto print-agent..."
  [ -n "$AGENT_PID" ] && kill "$AGENT_PID" 2>/dev/null || true
  pkill -f "print-agent-mac" 2>/dev/null || true
  echo "👋 Cassa aggiuntiva fermata. Arrivederci!"
}
trap cleanup EXIT INT TERM

# ── Funzioni di utilità ───────────────────────────────────────────────────────
log_info()  { echo "   $1"; }
log_ok()    { echo "✅ $1"; }
log_warn()  { echo "⚠️  $1"; }
log_err()   { echo "❌ $1"; }
log_step()  { echo ""; echo "──────────────────────────────────────────────────"; echo "🔧 $1"; }

# ── Assicura che Node.js sia nel PATH ─────────────────────────────────────────
if ! command -v node &>/dev/null; then
  export PATH="/usr/local/bin:/opt/homebrew/bin:$HOME/.nvm/versions/node/$(ls ~/.nvm/versions/node 2>/dev/null | sort -V | tail -1)/bin:$PATH"
fi
if ! command -v node &>/dev/null; then
  osascript -e 'display alert "Node.js non trovato" message "Installa Node.js da https://nodejs.org e riprova." as critical'
  exit 1
fi

# ── Gestione flag --reset ─────────────────────────────────────────────────────
if [ "$1" = "--reset" ]; then
  rm -f "$CONFIG_FILE"
  osascript -e 'display notification "Configurazione IP rimossa. Verrà richiesta di nuovo." with title "SagraPOS"'
fi

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║           SAGRA POS — CASSA AGGIUNTIVA (CLIENT)      ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""

# ── 1. Leggi o chiedi l'IP del server (con finestra grafica su macOS) ─────────
log_step "Configurazione indirizzo server"

SERVER_IP=""

# Prova a leggere da config.local.json
if [ -f "$CONFIG_FILE" ]; then
  SERVER_IP=$(python3 -c "
import json
try:
    with open('$CONFIG_FILE') as f:
        d = json.load(f)
    ip = d.get('serverIp', '')
    # Non usare l'IP se questo è il server stesso
    if ip and d.get('isServer') != True:
        print(ip)
except:
    pass
" 2>/dev/null || true)
fi

if [ -n "$SERVER_IP" ]; then
  log_ok "IP server trovato in config: $SERVER_IP"
  log_info "(Cancella config.local.json per cambiarlo)"
else
  # Prima esecuzione: usa finestra grafica AppleScript
  log_info "Prima esecuzione — mostro finestra di configurazione..."
  SERVER_IP=$(osascript << 'APPLESCRIPT'
set defaultIP to "192.168.1.10"
repeat
  set result to display dialog "Inserisci l'indirizzo IP del SERVER MASTER (Cassa 1)." & return & return & "Lo trovi nella finestra del server, sotto '📡 IP Server'." default answer defaultIP with title "SagraPOS — Configurazione" buttons {"Annulla", "Continua"} default button "Continua"
  if button returned of result is "Annulla" then
    error number -128
  end if
  set ipText to text returned of result
  if ipText is not "" then
    return ipText
  end if
  set defaultIP to ipText
end repeat
APPLESCRIPT
)

  if [ -z "$SERVER_IP" ]; then
    log_err "Nessun IP inserito. Uscita."
    exit 1
  fi

  log_ok "IP inserito: $SERVER_IP"

  # Salva nella config
  cat > "$CONFIG_FILE" << CONFIGEOF
{
  "serverIp": "$SERVER_IP",
  "isServer": false
}
CONFIGEOF
  log_ok "IP salvato in config.local.json (non verrà più richiesto)"
fi

# ── 2. Verifica connessione al server ─────────────────────────────────────────
log_step "Verifica connessione al server ($SERVER_IP:3001)"
SERVER_READY=0
for i in $(seq 1 30); do
  if curl -sf "http://$SERVER_IP:3001/health" >/dev/null 2>&1; then
    SERVER_READY=1
    break
  fi
  printf "   Tentativo %d/30 — attendo il server...\r" "$i"
  sleep 1
done
echo ""

if [ "$SERVER_READY" -eq 1 ]; then
  log_ok "Server raggiungibile su http://$SERVER_IP:3001"
else
  log_warn "Il server non risponde su http://$SERVER_IP:3001 dopo 30 secondi."
  RISPOSTA=$(osascript -e "display dialog \"Il server ($SERVER_IP) non risponde.\" & return & return & \"Vuoi continuare comunque?\" buttons {\"No, Esci\", \"Sì, Continua\"} default button \"No, Esci\" with title \"SagraPOS — Avviso\" with icon caution" -e "button returned of result" 2>/dev/null || echo "No, Esci")
  if [ "$RISPOSTA" != "Sì, Continua" ]; then
    exit 1
  fi
fi

# ── 3. Genera config.json per il print-agent ─────────────────────────────────
log_step "Configurazione print-agent"
AGENT_ID="agent-$(hostname | tr -d ' ' | tr '[:upper:]' '[:lower:]')-$$"
cat > "$PROJECT_ROOT/apps/print-agent/config.json" << PAEOF
{
  "SERVER_URL": "http://${SERVER_IP}:3001",
  "STATION_ID": "",
  "AGENT_ID": "$AGENT_ID",
  "printers": []
}
PAEOF
log_ok "config.json del print-agent generata (AGENT_ID: $AGENT_ID)"

# ── 4. Avvia il print-agent ───────────────────────────────────────────────────
log_step "Avvio Print Agent"
PRINT_AGENT_BIN=""
if [ "$(uname -m)" = "arm64" ] && [ -f "$PROJECT_ROOT/apps/print-agent/bin/print-agent-macos-arm64" ]; then
  PRINT_AGENT_BIN="$PROJECT_ROOT/apps/print-agent/bin/print-agent-macos-arm64"
elif [ -f "$PROJECT_ROOT/apps/print-agent/bin/print-agent-macos-x64" ]; then
  PRINT_AGENT_BIN="$PROJECT_ROOT/apps/print-agent/bin/print-agent-macos-x64"
fi

if [ -n "$PRINT_AGENT_BIN" ]; then
  chmod +x "$PRINT_AGENT_BIN"
  "$PRINT_AGENT_BIN" &
  AGENT_PID=$!
  log_ok "Print Agent avviato da binario (PID: $AGENT_PID)"
elif [ -d "$PROJECT_ROOT/apps/print-agent/dist" ]; then
  cd "$PROJECT_ROOT/apps/print-agent"
  node dist/index.js &
  AGENT_PID=$!
  cd "$PROJECT_ROOT"
  log_ok "Print Agent avviato da dist/ (PID: $AGENT_PID)"
else
  log_info "dist/ non trovato — compilo il print-agent..."
  cd "$PROJECT_ROOT/apps/print-agent"
  if npx tsc 2>/dev/null; then
    node dist/index.js &
    AGENT_PID=$!
    cd "$PROJECT_ROOT"
    log_ok "Print Agent compilato e avviato (PID: $AGENT_PID)"
  else
    cd "$PROJECT_ROOT"
    log_warn "Print Agent non avviato. La stampa locale non sarà disponibile."
    AGENT_PID=""
  fi
fi

# ── 5. Apri browser ───────────────────────────────────────────────────────────
log_step "Apertura browser"
sleep 2
open "http://$SERVER_IP:3000"

# ── 6. Riepilogo ─────────────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║       ✅  CASSA AGGIUNTIVA OPERATIVA!                ║"
echo "╠══════════════════════════════════════════════════════╣"
printf  "║  🖥️  POS    : %-39s║\n" "http://$SERVER_IP:3000"
printf  "║  👤 Admin  : %-39s║\n" "http://$SERVER_IP:3000/admin"
echo "╠══════════════════════════════════════════════════════╣"
echo "║  ⚠️  NON CHIUDERE QUESTA FINESTRA DURANTE IL SERVIZIO ║"
echo "║  👉 Chiudi questa finestra per fermare il print-agent ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""

# ── Mantieni in esecuzione ────────────────────────────────────────────────────
if [ -n "$AGENT_PID" ]; then
  wait "$AGENT_PID"
else
  read -rp "Print agent non attivo. Premi Invio per uscire..."
fi
