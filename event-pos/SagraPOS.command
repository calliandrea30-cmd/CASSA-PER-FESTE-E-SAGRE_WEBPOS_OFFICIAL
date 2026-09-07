#!/bin/bash
# ╔══════════════════════════════════════════════════════════════════════════╗
# ║                  🏪 SAGRA POS — PROGRAMMA UNIFICATO                      ║
# ║                  Doppio clic per avviare su macOS                       ║
# ╚══════════════════════════════════════════════════════════════════════════╝

cd "$(dirname "$0")"
PROJECT_ROOT="$(pwd)"
CONFIG_FILE="$PROJECT_ROOT/config.local.json"

API_PID=""
WEB_PID=""
AGENT_PID=""

cleanup() {
  echo ""
  echo "🛑 Arresto di tutti i servizi SagraPOS..."
  [ -n "$API_PID"   ] && kill "$API_PID"   2>/dev/null || true
  [ -n "$WEB_PID"   ] && kill "$WEB_PID"   2>/dev/null || true
  [ -n "$AGENT_PID" ] && kill "$AGENT_PID" 2>/dev/null || true
  pkill -f "print-agent" 2>/dev/null || true
  pkill -f "apps/api/dist" 2>/dev/null || true
  echo "👋 SagraPOS terminato. Arrivederci!"
}
trap cleanup EXIT INT TERM

log_info()  { echo "   $1"; }
log_ok()    { echo "✅ $1"; }
log_warn()  { echo "⚠️  $1"; }
log_err()   { echo "❌ $1"; }
log_step()  { echo ""; echo "──────────────────────────────────────────────────"; echo "🔧 $1"; }

clear 2>/dev/null || true
echo "╔══════════════════════════════════════════════════════════════════╗"
echo "║                  🏪 SAGRA POS — AVVIO SISTEMA                   ║"
echo "║               Sistema POS per Sagre ed Eventi                   ║"
echo "╚══════════════════════════════════════════════════════════════════╝"
echo ""

# ── 1. Verifica Node.js ───────────────────────────────────────────────────────
if ! command -v node &>/dev/null; then
  export PATH="/usr/local/bin:/opt/homebrew/bin:$HOME/.nvm/versions/node/$(ls ~/.nvm/versions/node 2>/dev/null | sort -V | tail -1)/bin:$PATH"
fi
if ! command -v node &>/dev/null; then
  echo "❌ Node.js non trovato sul sistema."
  osascript -e 'display alert "Node.js non trovato" message "SagraPOS richiede Node.js. Scaricalo gratuitamente da https://nodejs.org e riprova." as critical' 2>/dev/null || true
  open "https://nodejs.org" 2>/dev/null || true
  exit 1
fi
log_ok "Node.js $(node --version) presente"

# ── 2. Verifica e installazione automatica dipendenze ─────────────────────────
if [ ! -d "$PROJECT_ROOT/node_modules" ]; then
  log_step "Prima installazione: scarico i componenti necessari..."
  log_info "Questa operazione richiede solo pochi minuti..."
  npm install || { log_err "Installazione fallita. Controlla la connessione internet."; exit 1; }
  log_ok "Componenti installati con successo!"
fi

# ── 3. Compilazione automatica componenti se non compilati ───────────────────
if [ ! -d "$PROJECT_ROOT/apps/api/dist" ]; then
  log_step "Compilazione API Server..."
  cd "$PROJECT_ROOT/apps/api" && npx tsc && cd "$PROJECT_ROOT"
  log_ok "API compilata!"
fi

if [ ! -d "$PROJECT_ROOT/apps/web/.next" ]; then
  log_step "Compilazione Interfaccia Web..."
  cd "$PROJECT_ROOT/apps/web" && npx next build && cd "$PROJECT_ROOT"
  log_ok "Interfaccia Web compilata!"
fi

if [ ! -d "$PROJECT_ROOT/apps/print-agent/dist" ]; then
  log_step "Compilazione Print Agent stampante..."
  cd "$PROJECT_ROOT/apps/print-agent" && npx tsc && cd "$PROJECT_ROOT"
  log_ok "Print Agent compilato!"
fi

# ── 4. Scelta modalità (Server Principale o Cassa Aggiuntiva) ─────────────────
CURRENT_MODE=""
CURRENT_SERVER_IP=""
if [ -f "$CONFIG_FILE" ]; then
  if grep -q '"isServer": true' "$CONFIG_FILE" 2>/dev/null; then
    CURRENT_MODE="1"
  elif grep -q '"isServer": false' "$CONFIG_FILE" 2>/dev/null; then
    CURRENT_MODE="2"
    CURRENT_SERVER_IP=$(python3 -c "import json; print(json.load(open('$CONFIG_FILE')).get('serverIp',''))" 2>/dev/null || true)
  fi
fi

echo ""
echo "Come vuoi utilizzare questo computer?"
echo ""
echo "  [1] CASSA 1 — SERVER PRINCIPALE (Questo computer gestisce database + cassa)"
echo "  [2] CASSA AGGIUNTIVA / SECONDARIA (Si collega alla Cassa 1 via Wi-Fi o Hotspot)"
echo "  [3] Reset configurazione"
echo ""

SCELTA=""
if [ -n "$CURRENT_MODE" ]; then
  if [ "$CURRENT_MODE" = "1" ]; then
    echo "💡 Modalità salvata: [1] CASSA 1 (SERVER PRINCIPALE)"
  else
    echo "💡 Modalità salvata: [2] CASSA AGGIUNTIVA (Server: $CURRENT_SERVER_IP)"
  fi
  echo "Premi INVIO per confermare, o digita 1, 2 o 3 [avvio auto in 4 secondi]:"
  read -t 4 -r SCELTA || true
  if [ -z "$SCELTA" ]; then
    SCELTA="$CURRENT_MODE"
  fi
else
  printf "Digita 1 o 2 e premi Invio [default: 1]: "
  read -r SCELTA
  [ -z "$SCELTA" ] && SCELTA="1"
fi

if [ "$SCELTA" = "3" ]; then
  rm -f "$CONFIG_FILE"
  echo "✅ Configurazione resettata."
  printf "Scegli ora: 1 (Server) o 2 (Cassa Aggiuntiva): "
  read -r SCELTA
  [ -z "$SCELTA" ] && SCELTA="1"
fi

# ══════════════════════════════════════════════════════════════════════════════
# MODALITÀ 1: CASSA 1 (SERVER PRINCIPALE)
# ══════════════════════════════════════════════════════════════════════════════
if [ "$SCELTA" = "1" ]; then
  log_step "Avvio modalità CASSA 1 (SERVER MASTER)"

  # Rilevamento IP di rete (Wi-Fi, LAN, Hotspot)
  SERVER_IP=""
  if command -v ifconfig &>/dev/null; then
    SERVER_IP=$(ifconfig | grep "inet " | grep -v "127.0.0.1" | grep -v "169.254" | awk '{print $2}' | head -1)
  fi
  [ -z "$SERVER_IP" ] && SERVER_IP="127.0.0.1"

  cat > "$CONFIG_FILE" << CONFIGEOF
{
  "isServer": true,
  "serverIp": "$SERVER_IP"
}
CONFIGEOF

  # Libera porte 3000 e 3001
  for PORT in 3001 3000; do
    PIDS_ON_PORT=$(lsof -ti :"$PORT" 2>/dev/null || true)
    if [ -n "$PIDS_ON_PORT" ]; then
      echo "$PIDS_ON_PORT" | xargs kill -9 2>/dev/null || true
      sleep 1
    fi
  done

  # Database SQLite (Prisma)
  cd "$PROJECT_ROOT/apps/api"
  npx prisma db push --accept-data-loss 2>/dev/null || true
  npx prisma generate 2>/dev/null || true
  cd "$PROJECT_ROOT"

  # Configura Print Agent locale
  cat > "$PROJECT_ROOT/apps/print-agent/config.json" << PAEOF
{
  "SERVER_URL": "http://127.0.0.1:3001",
  "STATION_ID": "",
  "AGENT_ID": "agent-server-local",
  "printers": []
}
PAEOF

  # Avvia API Server su 0.0.0.0
  log_step "Avvio API server (porta 3001)..."
  cd "$PROJECT_ROOT/apps/api"
  PORT=3001 HOST=0.0.0.0 NODE_ENV=production node dist/index.js &
  API_PID=$!
  cd "$PROJECT_ROOT"

  # Attendi API
  for i in $(seq 1 30); do
    if curl -sf "http://127.0.0.1:3001/api/settings" >/dev/null 2>&1; then break; fi
    sleep 1
  done

  # Avvia Web App su 0.0.0.0 (fondamentale per hotspot e altre casse!)
  log_step "Avvio Interfaccia Web (porta 3000)..."
  cd "$PROJECT_ROOT/apps/web"
  npx next start -p 3000 -H 0.0.0.0 &
  WEB_PID=$!
  cd "$PROJECT_ROOT"

  # Avvia Print Agent
  log_step "Avvio Print Agent stampante..."
  cd "$PROJECT_ROOT/apps/print-agent"
  node dist/index.js &
  AGENT_PID=$!
  cd "$PROJECT_ROOT"

  # Attendi Web
  for i in $(seq 1 30); do
    if curl -sf "http://127.0.0.1:3000" >/dev/null 2>&1; then break; fi
    sleep 1
  done

  echo ""
  echo "╔══════════════════════════════════════════════════════════════════╗"
  echo "║                ✅  SAGRA POS OPERATIVO! (CASSA 1)                ║"
  echo "╠══════════════════════════════════════════════════════════════════╣"
  printf "║  🖥️  Cassa locale : %-44s║\n" "http://localhost:3000"
  printf "║  👤  Admin        : %-44s║\n" "http://localhost:3000/admin"
  printf "║  🍽️  Cucina (KDS) : %-44s║\n" "http://localhost:3000/kds"
  echo "╠══════════════════════════════════════════════════════════════════╣"
  printf "║  📱  COLLEGA LE ALTRE CASSE / SMARTPHONE A QUESTO INDIRIZZO:     ║\n"
  printf "║      👉 http://%-47s║\n" "$SERVER_IP:3000"
  echo "║                                                                  ║"
  echo "║  ⚠️  Se usi Hotspot dal telefono: connetti tutti i computer       ║"
  echo "║     all'Hotspot e usa l'indirizzo IP mostrato sopra!             ║"
  echo "║                                                                  ║"
  echo "║  ⚠️  NON CHIUDERE QUESTA FINESTRA DURANTE IL SERVIZIO            ║"
  echo "╚══════════════════════════════════════════════════════════════════╝"
  echo ""

  # Apri browser
  open "http://localhost:3000" 2>/dev/null || true

  wait "$API_PID"

# ══════════════════════════════════════════════════════════════════════════════
# MODALITÀ 2: CASSA AGGIUNTIVA / SECONDARIA
# ══════════════════════════════════════════════════════════════════════════════
else
  log_step "Avvio modalità CASSA AGGIUNTIVA (CLIENT)"

  SERVER_IP="$CURRENT_SERVER_IP"

  if [ -z "$SERVER_IP" ]; then
    # Chiedi IP del server con popup grafico macOS
    SERVER_IP=$(osascript << 'APPLESCRIPT' 2>/dev/null || true
set defaultIP to "192.168."
try
  set result to display dialog "Inserisci l'indirizzo IP del computer SERVER MASTER (Cassa 1):" & return & return & "(Lo trovi scritto nella finestra nera della Cassa 1, es. 192.168.1.50 oppure 192.168.43.10)" default answer defaultIP with title "SagraPOS — Cassa Aggiuntiva" buttons {"Annulla", "Connetti"} default button "Connetti"
  if button returned of result is "Connetti" then
    return text returned of result
  end if
on error
  return ""
end try
APPLESCRIPT
)
  fi

  if [ -z "$SERVER_IP" ]; then
    printf "Inserisci l'IP del Server Cassa 1 (es. 192.168.1.100): "
    read -r SERVER_IP
  fi

  if [ -z "$SERVER_IP" ]; then
    log_err "Nessun IP inserito. Impossibile avviare."
    exit 1
  fi

  # Pulisci eventuale http:// o :3000 inserito dall'utente per errore
  SERVER_IP=$(echo "$SERVER_IP" | sed -e 's|http://||g' -e 's|https://||g' -e 's|:3000||g' -e 's|:3001||g' -e 's|/.*||g')

  cat > "$CONFIG_FILE" << CONFIGEOF
{
  "isServer": false,
  "serverIp": "$SERVER_IP"
}
CONFIGEOF

  # Configura Print Agent per la cassa aggiuntiva
  cat > "$PROJECT_ROOT/apps/print-agent/config.json" << PAEOF
{
  "SERVER_URL": "http://$SERVER_IP:3001",
  "STATION_ID": "",
  "AGENT_ID": "agent-client-$(hostname)",
  "printers": []
}
PAEOF

  # Avvia Print Agent locale
  log_step "Avvio Print Agent per stampanti locali..."
  cd "$PROJECT_ROOT/apps/print-agent"
  node dist/index.js &
  AGENT_PID=$!
  cd "$PROJECT_ROOT"

  echo ""
  echo "╔══════════════════════════════════════════════════════════════════╗"
  echo "║            ✅  CASSA AGGIUNTIVA CONNESSA AL SERVER!              ║"
  echo "╠══════════════════════════════════════════════════════════════════╣"
  printf "║  📡 Server collegato : %-41s║\n" "http://$SERVER_IP:3000"
  echo "║                                                                  ║"
  echo "║  Il browser si sta aprendo sulla schermata di vendita.          ║"
  echo "║  ⚠️  NON CHIUDERE QUESTA FINESTRA DURANTE IL SERVIZIO            ║"
  echo "╚══════════════════════════════════════════════════════════════════╝"
  echo ""

  # Apri browser puntato al server
  open "http://$SERVER_IP:3000" 2>/dev/null || true

  wait "$AGENT_PID"
fi
