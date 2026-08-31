#!/bin/bash
# ╔══════════════════════════════════════════════════════════════════════════╗
# ║            SAGRA POS — AVVIA CASSA 1 (SERVER MASTER)                    ║
# ║            macOS / Linux  ·  chmod +x && ./AVVIA_CASSA_1_SERVER.sh      ║
# ╚══════════════════════════════════════════════════════════════════════════╝

# ── Spostati nella directory del progetto ─────────────────────────────────────
cd "$(dirname "$0")"
PROJECT_ROOT="$(pwd)"

# ── Variabili globali PID ─────────────────────────────────────────────────────
API_PID=""
WEB_PID=""
AGENT_PID=""

# ── Cleanup alla chiusura (trap PRIMA di tutto) ───────────────────────────────
cleanup() {
  echo ""
  echo "🛑 Arresto SagraPOS in corso..."
  [ -n "$API_PID"   ] && kill "$API_PID"   2>/dev/null || true
  [ -n "$WEB_PID"   ] && kill "$WEB_PID"   2>/dev/null || true
  [ -n "$AGENT_PID" ] && kill "$AGENT_PID" 2>/dev/null || true
  pkill -f "print-agent-mac" 2>/dev/null || true
  pkill -f "apps/api/dist"   2>/dev/null || true
  pkill -f "apps/web"        2>/dev/null || true
  echo "👋 SagraPOS fermato. Arrivederci!"
}
trap cleanup EXIT INT TERM

# ── Funzioni di utilità ───────────────────────────────────────────────────────
log_info()  { echo "   $1"; }
log_ok()    { echo "✅ $1"; }
log_warn()  { echo "⚠️  $1"; }
log_err()   { echo "❌ $1"; }
log_step()  { echo ""; echo "──────────────────────────────────────────────────"; echo "🔧 $1"; }

# ── 0. Verifica Node.js ───────────────────────────────────────────────────────
log_step "Verifica requisiti di sistema"
if ! command -v node &>/dev/null; then
  log_err "Node.js non trovato. Scaricalo da: https://nodejs.org"
  exit 1
fi
log_ok "Node.js $(node --version) trovato"

if ! command -v npm &>/dev/null; then
  log_err "npm non trovato. Reinstalla Node.js da: https://nodejs.org"
  exit 1
fi

# ── 1. Individua IP locale ────────────────────────────────────────────────────
log_step "Rilevamento indirizzo IP"
if command -v ifconfig &>/dev/null; then
  SERVER_IP=$(ifconfig | grep "inet " \
    | grep -v "127.0.0.1" | grep -v "169.254" \
    | awk '{print $2}' | head -1)
elif command -v ip &>/dev/null; then
  SERVER_IP=$(ip addr show \
    | grep "inet " | grep -v "127.0.0.1" | grep -v "169.254" \
    | awk '{print $2}' | cut -d/ -f1 | head -1)
fi

if [ -z "$SERVER_IP" ]; then
  log_warn "Impossibile rilevare l'IP di rete — uso 127.0.0.1"
  SERVER_IP="127.0.0.1"
else
  log_ok "IP rilevato: $SERVER_IP"
fi

# Salva l'IP in .server_ip per uso rapido da altri script
echo "$SERVER_IP" > "$PROJECT_ROOT/.server_ip"

# Salva configurazione in config.local.json
cat > "$PROJECT_ROOT/config.local.json" << CONFIGEOF
{
  "serverIp": "$SERVER_IP",
  "isServer": true
}
CONFIGEOF
log_ok "Configurazione salvata in config.local.json"

# ── 2. Banner ─────────────────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║               SAGRA POS — SERVER MASTER              ║"
echo "╠══════════════════════════════════════════════════════╣"
printf  "║  📡 IP Server : %-36s║\n" "$SERVER_IP"
printf  "║  🌐 POS       : %-36s║\n" "http://$SERVER_IP:3000"
printf  "║  🔧 API       : %-36s║\n" "http://$SERVER_IP:3001"
printf  "║  👤 Admin     : %-36s║\n" "http://$SERVER_IP:3000/admin"
echo "╠══════════════════════════════════════════════════════╣"
echo "║  ➕ Altre casse: apri AVVIA_CASSA_AGGIUNTIVA         ║"
echo "║     e inserisci l'IP sopra quando richiesto.         ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""

# ── 3. Libera le porte se occupate ────────────────────────────────────────────
log_step "Verifica porte 3000 e 3001"
for PORT in 3001 3000; do
  PIDS_ON_PORT=$(lsof -ti :"$PORT" 2>/dev/null || true)
  if [ -n "$PIDS_ON_PORT" ]; then
    log_warn "Porta $PORT occupata (PID: $PIDS_ON_PORT) — la libero..."
    echo "$PIDS_ON_PORT" | xargs kill -9 2>/dev/null || true
    sleep 1
    log_ok "Porta $PORT liberata"
  else
    log_ok "Porta $PORT libera"
  fi
done

# ── 4. Installa dipendenze se necessario ──────────────────────────────────────
log_step "Dipendenze npm"
if [ ! -d "$PROJECT_ROOT/node_modules" ]; then
  log_info "Prima esecuzione: installo le dipendenze (potrebbe richiedere qualche minuto)..."
  npm install || { log_err "npm install fallito. Verifica la connessione a internet."; exit 1; }
  log_ok "Dipendenze installate"
else
  log_ok "node_modules presente"
fi

# ── 5. Build API (TypeScript → JS) ────────────────────────────────────────────
log_step "Compilazione API"
if [ ! -d "$PROJECT_ROOT/apps/api/dist" ]; then
  log_info "dist/ non trovato — compilo l'API TypeScript (prima esecuzione)..."
  cd "$PROJECT_ROOT/apps/api"
  npx tsc || { log_err "Compilazione API fallita. Controlla gli errori TypeScript sopra."; exit 1; }
  cd "$PROJECT_ROOT"
  log_ok "API compilata in apps/api/dist/"
else
  log_ok "apps/api/dist/ già presente"
fi

# ── 6. Build Web App ──────────────────────────────────────────────────────────
log_step "Build Web App (Next.js)"
if [ ! -d "$PROJECT_ROOT/apps/web/.next" ]; then
  log_info ".next/ non trovato — eseguo next build (potrebbe richiedere qualche minuto)..."
  cd "$PROJECT_ROOT/apps/web"
  npx next build || { log_err "Build Next.js fallita. Controlla gli errori sopra."; exit 1; }
  cd "$PROJECT_ROOT"
  log_ok "Web App compilata in apps/web/.next/"
else
  log_ok "apps/web/.next/ già presente"
fi

# ── 7. Genera schema Prisma / Migrazione DB ───────────────────────────────────
log_step "Database"
cd "$PROJECT_ROOT/apps/api"
if [ ! -f "prisma/dev.db" ] && [ ! -f "dev.db" ]; then
  log_info "Primo avvio: creo il database..."
  npx prisma migrate deploy 2>/dev/null \
    || npx prisma db push --accept-data-loss 2>/dev/null \
    || true
else
  npx prisma db push --accept-data-loss 2>/dev/null || true
fi
npx prisma generate 2>/dev/null || true
cd "$PROJECT_ROOT"
log_ok "Database aggiornato"

# ── 8. Configura print-agent locale ───────────────────────────────────────────
log_step "Configurazione print-agent"
cat > "$PROJECT_ROOT/apps/print-agent/config.json" << PAEOF
{
  "SERVER_URL": "http://127.0.0.1:3001",
  "STATION_ID": "",
  "AGENT_ID": "agent-server-local",
  "printers": []
}
PAEOF
log_ok "config.json del print-agent generata"

# ── 9. Avvia API ──────────────────────────────────────────────────────────────
log_step "Avvio API server (porta 3001)"
cd "$PROJECT_ROOT/apps/api"
NODE_ENV=production node dist/index.js &
API_PID=$!
cd "$PROJECT_ROOT"
log_ok "API avviata (PID: $API_PID)"

# ── 10. Attendi che l'API sia pronta (polling /health) ────────────────────────
log_step "Attendo che l'API sia pronta"
API_READY=0
for i in $(seq 1 30); do
  if curl -sf "http://127.0.0.1:3001/health" >/dev/null 2>&1; then
    API_READY=1
    break
  fi
  # Verifica che il processo API sia ancora vivo
  if ! kill -0 "$API_PID" 2>/dev/null; then
    log_err "Il processo API si è fermato inaspettatamente."
    log_info "Controlla che apps/api/dist/index.js esista e riprova."
    exit 1
  fi
  printf "   Tentativo %d/30...\r" "$i"
  sleep 1
done
echo ""
if [ "$API_READY" -eq 0 ]; then
  log_warn "L'API non ha risposto su /health entro 30s — procedo comunque."
else
  log_ok "API pronta e risponde su http://127.0.0.1:3001/health"
fi

# ── 11. Avvia Web App ─────────────────────────────────────────────────────────
log_step "Avvio Web App (porta 3000)"
cd "$PROJECT_ROOT/apps/web"
npx next start -p 3000 &
WEB_PID=$!
cd "$PROJECT_ROOT"
log_ok "Web App avviata (PID: $WEB_PID)"

# ── 12. Avvia Print Agent ─────────────────────────────────────────────────────
log_step "Avvio Print Agent locale"
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
  log_info "dist/ del print-agent non trovato — compilo..."
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

# ── 13. Attendi porta 3000 e apri browser ────────────────────────────────────
log_step "Apertura browser"
WEB_READY=0
for i in $(seq 1 30); do
  if curl -sf "http://127.0.0.1:3000" >/dev/null 2>&1; then
    WEB_READY=1
    break
  fi
  printf "   Attendo porta 3000... (%d/30)\r" "$i"
  sleep 1
done
echo ""

if command -v open &>/dev/null; then
  open "http://localhost:3000"
elif command -v xdg-open &>/dev/null; then
  xdg-open "http://localhost:3000"
fi

# ── 14. Riepilogo finale ──────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║           ✅  SAGRA POS OPERATIVO!                   ║"
echo "╠══════════════════════════════════════════════════════╣"
printf  "║  🖥️  POS       : %-36s║\n" "http://localhost:3000"
printf  "║  👤 Admin     : %-36s║\n" "http://localhost:3000/admin"
printf  "║  🍽️  KDS       : %-36s║\n" "http://localhost:3000/kds"
printf  "║  🔧 API       : %-36s║\n" "http://localhost:3001"
echo "╠══════════════════════════════════════════════════════╣"
printf  "║  📡 Altre casse: http://%-29s║\n" "$SERVER_IP:3000"
echo "╠══════════════════════════════════════════════════════╣"
echo "║  ⚠️  NON CHIUDERE QUESTA FINESTRA DURANTE IL SERVIZIO ║"
echo "║  👉 Premi Ctrl+C per fermare tutto a fine serata.    ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""

# ── Mantieni in esecuzione ────────────────────────────────────────────────────
wait "$API_PID"
