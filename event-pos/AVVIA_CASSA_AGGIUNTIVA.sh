#!/bin/bash
# ╔══════════════════════════════════════════════════════════════════════════╗
# ║         SAGRA POS — AVVIA CASSA AGGIUNTIVA (CLIENT)                     ║
# ║         macOS / Linux  ·  chmod +x && ./AVVIA_CASSA_AGGIUNTIVA.sh       ║
# ║                                                                          ║
# ║  Uso: ./AVVIA_CASSA_AGGIUNTIVA.sh            # usa config salvata        ║
# ║       ./AVVIA_CASSA_AGGIUNTIVA.sh --reset    # dimentica IP e richiede  ║
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

# ── Gestione flag --reset ─────────────────────────────────────────────────────
if [ "$1" = "--reset" ]; then
  if [ -f "$CONFIG_FILE" ]; then
    # Rimuove la chiave serverIp ma mantiene isServer se presente
    TMP=$(mktemp)
    python3 -c "
import json, sys
with open('$CONFIG_FILE') as f:
    d = json.load(f)
d.pop('serverIp', None)
d['isServer'] = False
with open('$CONFIG_FILE', 'w') as f:
    json.dump(d, f, indent=2)
" 2>/dev/null || rm -f "$CONFIG_FILE"
    echo "🗑️  Configurazione IP rimossa. Verrà richiesta di nuovo."
  else
    echo "ℹ️  Nessuna configurazione salvata."
  fi
fi

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║           SAGRA POS — CASSA AGGIUNTIVA (CLIENT)      ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""

# ── 1. Leggi o chiedi l'IP del server ────────────────────────────────────────
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
    if ip and d.get('isServer') != True:
        print(ip)
except:
    pass
" 2>/dev/null || true)
fi

# Se non trovato nella config, prova .server_ip (stesso PC)
if [ -z "$SERVER_IP" ] && [ -f "$PROJECT_ROOT/.server_ip" ]; then
  SERVER_IP=$(cat "$PROJECT_ROOT/.server_ip" 2>/dev/null || true)
  log_info "(IP letto da .server_ip: $SERVER_IP)"
fi

if [ -n "$SERVER_IP" ]; then
  log_ok "IP server trovato in config: $SERVER_IP"
  echo "   (Usa --reset per cambiarlo)"
else
  # Prima esecuzione: chiedi l'IP
  echo "   Prima esecuzione: inserisci l'IP del SERVER MASTER."
  echo "   Lo trovi nella finestra del server, sotto '📡 IP Server'."
  echo ""
  while true; do
    read -rp "   👉 Indirizzo IP del server (es. 192.168.1.10): " SERVER_IP
    if [[ "$SERVER_IP" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
      break
    fi
    log_warn "Formato IP non valido. Inserisci un IP nel formato x.x.x.x"
  done

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
  echo ""
  echo "   Possibili cause:"
  echo "   • Il server non è stato avviato (avvia AVVIA_CASSA_1_SERVER sul server)"
  echo "   • L'IP $SERVER_IP non è corretto (usa --reset per cambiarlo)"
  echo "   • Firewall o rete separata"
  echo ""
  read -rp "   Continuare comunque? (s/n): " RISPOSTA
  [[ "$RISPOSTA" =~ ^[Ss]$ ]] || exit 1
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
if command -v open &>/dev/null; then
  open "http://$SERVER_IP:3000"
elif command -v xdg-open &>/dev/null; then
  xdg-open "http://$SERVER_IP:3000"
fi

# ── 6. Riepilogo ─────────────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║       ✅  CASSA AGGIUNTIVA OPERATIVA!                ║"
echo "╠══════════════════════════════════════════════════════╣"
printf  "║  🖥️  POS    : %-39s║\n" "http://$SERVER_IP:3000"
printf  "║  👤 Admin  : %-39s║\n" "http://$SERVER_IP:3000/admin"
echo "╠══════════════════════════════════════════════════════╣"
echo "║  ⚠️  NON CHIUDERE QUESTA FINESTRA DURANTE IL SERVIZIO ║"
echo "║  👉 Premi Ctrl+C per fermare il print-agent.         ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""

# ── Mantieni in esecuzione ────────────────────────────────────────────────────
if [ -n "$AGENT_PID" ]; then
  wait "$AGENT_PID"
else
  read -rp "Print agent non attivo. Premi Invio per uscire..."
fi
