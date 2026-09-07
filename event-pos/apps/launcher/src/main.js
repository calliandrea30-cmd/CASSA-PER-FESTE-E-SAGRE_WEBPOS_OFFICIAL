'use strict';

const { app, BrowserWindow, ipcMain, Tray, Menu, shell, dialog, nativeImage } = require('electron');
const path  = require('path');
const fs    = require('fs');
const os    = require('os');
const net   = require('net');
const http  = require('http');
const { spawn, execSync } = require('child_process');

// ─── Modalità ─────────────────────────────────────────────────────────────────
const IS_DEV  = process.argv.includes('--dev') || !app.isPackaged;
const IS_WIN  = process.platform === 'win32';
const IS_MAC  = process.platform === 'darwin';

// ─── Percorsi ─────────────────────────────────────────────────────────────────
// In development: siamo in apps/launcher/src/ → risaliamo di 3 livelli
// In production:  le risorse sono in process.resourcesPath
const PROJ_ROOT = IS_DEV
  ? path.join(__dirname, '..', '..', '..')   // event-pos/
  : null;

const RES = IS_DEV ? null : process.resourcesPath;

const PATHS = {
  api:       IS_DEV ? path.join(PROJ_ROOT, 'apps', 'api')                   : path.join(RES, 'api'),
  web:       IS_DEV ? path.join(PROJ_ROOT, 'apps', 'web')                   : path.join(RES, 'web'),
  agent:     IS_DEV ? path.join(PROJ_ROOT, 'apps', 'print-agent')           : path.join(RES, 'agent'),
  db:        path.join(app.getPath('userData'), 'data'),
  config:    path.join(app.getPath('userData'), 'sagrapos-config.json'),
  ui:        path.join(__dirname, 'ui'),
};

// ─── Config persistente (semplice JSON, non dipende da electron-store) ────────
const CONFIG_DEFAULTS = {
  setupComplete: false,
  isServer: true,
  serverUrl: 'http://127.0.0.1:3001',
  stationId: null,
  stationName: null,
};

function loadConfig() {
  try {
    const raw = fs.readFileSync(PATHS.config, 'utf8');
    return { ...CONFIG_DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...CONFIG_DEFAULTS };
  }
}

function saveConfig(data) {
  try {
    fs.mkdirSync(path.dirname(PATHS.config), { recursive: true });
    const existing = loadConfig();
    fs.writeFileSync(PATHS.config, JSON.stringify({ ...existing, ...data }, null, 2));
  } catch (e) {
    console.error('[Config] Errore salvataggio:', e.message);
  }
}

// ─── Stato dei processi ────────────────────────────────────────────────────────
let processes = { api: null, web: null, agent: null };
let mainWin   = null;
let setupWin  = null;
let tray      = null;
let startupLogs = [];

function addLog(msg) {
  const line = `[${new Date().toLocaleTimeString('it-IT')}] ${msg}`;
  startupLogs.push(line);
  if (startupLogs.length > 200) startupLogs.shift();
  console.log(line);
  if (mainWin && !mainWin.isDestroyed()) {
    mainWin.webContents.send('log', line);
  }
}

// ─── Trova Node.js ────────────────────────────────────────────────────────────
function findNode() {
  // 1. Node bundled nelle risorse (produzione)
  if (!IS_DEV) {
    const bundled = path.join(process.resourcesPath, 'node', IS_WIN ? 'node.exe' : 'node');
    if (fs.existsSync(bundled)) return bundled;
  }
  // 2. Node di sistema
  try {
    const cmd = IS_WIN ? 'where node' : 'which node';
    const found = execSync(cmd, { encoding: 'utf8' }).trim().split(/\r?\n/)[0];
    if (found && fs.existsSync(found)) return found;
  } catch {}
  // 3. Percorsi comuni
  const candidates = IS_WIN
    ? ['C:\\Program Files\\nodejs\\node.exe', 'C:\\Program Files (x86)\\nodejs\\node.exe']
    : ['/usr/local/bin/node', '/usr/bin/node', '/opt/homebrew/bin/node', `${os.homedir()}/.nvm/versions/node/current/bin/node`];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

// ─── IP locale ────────────────────────────────────────────────────────────────
function getLocalIPs() {
  const ips = [];
  try {
    for (const [, addrs] of Object.entries(os.networkInterfaces())) {
      for (const a of addrs) {
        if (a.family === 'IPv4' && !a.internal) ips.push(a.address);
      }
    }
  } catch {}
  return ips;
}

// ─── Porta libera? ────────────────────────────────────────────────────────────
function isPortFree(port) {
  return new Promise(resolve => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.once('listening', () => { s.close(); resolve(true); });
    s.listen(port, '127.0.0.1');
  });
}

// ─── Aspetta che la porta sia attiva ──────────────────────────────────────────
function waitForPort(port, host = '127.0.0.1', timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    function tryConnect() {
      const s = new net.Socket();
      s.setTimeout(1000);
      s.on('connect', () => { s.destroy(); resolve(); });
      s.on('error', () => {
        s.destroy();
        if (Date.now() - start > timeoutMs) return reject(new Error(`Port ${port} not available after ${timeoutMs}ms`));
        setTimeout(tryConnect, 500);
      });
      s.on('timeout', () => { s.destroy(); setTimeout(tryConnect, 500); });
      s.connect(port, host);
    }
    tryConnect();
  });
}

// ─── Avvia processo figlio ────────────────────────────────────────────────────
function startProcess(key, nodeBin, script, cwd, extraEnv = {}) {
  if (processes[key]) {
    try { processes[key].kill('SIGTERM'); } catch {}
    processes[key] = null;
  }

  const env = {
    ...process.env,
    NODE_ENV: 'production',
    ...extraEnv,
  };

  addLog(`▶ Avvio ${key}...`);

  const proc = spawn(nodeBin, [script], { cwd, env, windowsHide: true });
  processes[key] = proc;

  proc.stdout.on('data', d => addLog(`[${key}] ${d.toString().trim()}`));
  proc.stderr.on('data', d => {
    const msg = d.toString().trim();
    if (msg && !msg.includes('DeprecationWarning') && !msg.includes('ExperimentalWarning')) {
      addLog(`[${key} ERR] ${msg}`);
    }
  });
  proc.on('exit', (code, sig) => {
    addLog(`[${key}] Processo terminato (code=${code} sig=${sig})`);
    processes[key] = null;
    updateStatus();
  });
  proc.on('error', e => {
    addLog(`[${key} SPAWN ERROR] ${e.message}`);
    processes[key] = null;
    updateStatus();
  });

  return proc;
}

// ─── Aggiorna stato UI ────────────────────────────────────────────────────────
function updateStatus() {
  if (!mainWin || mainWin.isDestroyed()) return;
  mainWin.webContents.send('status', {
    api:   !!processes.api,
    web:   !!processes.web,
    agent: !!processes.agent,
    localIPs: getLocalIPs(),
    config: loadConfig(),
  });
}

// ─── Sequenza avvio SERVER ────────────────────────────────────────────────────
async function startServer(nodeBin) {
  const cfg = loadConfig();
  addLog('🚀 Avvio modalità SERVER...');

  // ── Crea cartella DB ──────────────────────────────────────────────────────
  fs.mkdirSync(PATHS.db, { recursive: true });

  const apiEnv = {
    PORT: '3001',
    DATABASE_URL: `file:${path.join(PATHS.db, 'pos.db')}`,
    LOG_LEVEL: 'warn',
  };

  // ── Esegui migrazione Prisma ──────────────────────────────────────────────
  addLog('🗄️  Inizializzazione database...');
  const prismaPath = IS_DEV
    ? path.join(PATHS.api, 'node_modules', '.bin', IS_WIN ? 'prisma.cmd' : 'prisma')
    : path.join(PATHS.api, 'node_modules', '.bin', IS_WIN ? 'prisma.cmd' : 'prisma');

  try {
    await new Promise((resolve) => {
      const p = spawn(nodeBin, [
        path.join(IS_DEV ? PATHS.api + '/node_modules/prisma/build/index.js' : PATHS.api + '/node_modules/prisma/build/index.js'),
        'db', 'push', '--accept-data-loss', '--skip-generate'
      ], {
        cwd: PATHS.api,
        env: { ...process.env, ...apiEnv },
        windowsHide: true,
      });
      p.on('exit', resolve);
      p.on('error', resolve);
      setTimeout(resolve, 15000); // timeout 15s
    });
    addLog('✅ Database pronto');
  } catch (e) {
    addLog(`⚠️  Migrazione DB: ${e.message} (continuo comunque)`);
  }

  // ── API Server ────────────────────────────────────────────────────────────
  const apiScript = IS_DEV
    ? path.join(PATHS.api, 'node_modules', 'ts-node-dev', 'lib', 'bin.js')
    : path.join(PATHS.api, 'dist', 'index.js');

  const apiArgs = IS_DEV
    ? ['--respawn', '--transpile-only', path.join(PATHS.api, 'src', 'index.ts')]
    : [path.join(PATHS.api, 'dist', 'index.js')];

  // In dev, usiamo ts-node-dev; in prod, il file JS compilato
  if (IS_DEV) {
    const devBin = path.join(PATHS.api, 'node_modules', '.bin', IS_WIN ? 'ts-node-dev.cmd' : 'ts-node-dev');
    startProcess('api', devBin, '', PATHS.api, apiEnv); // script vuoto, passiamo via argv
    // Riavviamo con i giusti argomenti
    if (processes.api) { try { processes.api.kill(); } catch {} }
    const apiProc = spawn(devBin, ['--respawn', '--transpile-only', 'src/index.ts'], {
      cwd: PATHS.api,
      env: { ...process.env, ...apiEnv },
      windowsHide: true,
    });
    processes.api = apiProc;
    apiProc.stdout.on('data', d => addLog(`[api] ${d.toString().trim()}`));
    apiProc.stderr.on('data', d => {
      const m = d.toString().trim();
      if (m && !m.includes('DeprecationWarning')) addLog(`[api] ${m}`);
    });
    apiProc.on('exit', (code) => { addLog(`[api] Terminato (${code})`); processes.api = null; updateStatus(); });
  } else {
    startProcess('api', nodeBin, path.join(PATHS.api, 'dist', 'index.js'), PATHS.api, apiEnv);
  }

  // ── Aspetta API ───────────────────────────────────────────────────────────
  addLog('⏳ Attendo che l\'API sia pronta (porta 3001)...');
  try {
    await waitForPort(3001, '127.0.0.1', 60000);
    addLog('✅ API Server pronto!');
  } catch {
    addLog('⚠️  API impiega più del solito ad avviarsi.');
  }

  // ── Web App ───────────────────────────────────────────────────────────────
  addLog('🌐 Avvio Web App (porta 3000)...');

  // Prova prima con il server standalone (next build con output: 'standalone')
  // In un monorepo, Next.js genera server.js in .next/standalone/apps/web/server.js
  let standaloneServer = null;
  let standaloneCwd = null;
  if (!IS_DEV) {
    const monoPath = path.join(PATHS.web, '.next', 'standalone', 'apps', 'web', 'server.js');
    const directPath = path.join(PATHS.web, '.next', 'standalone', 'server.js');
    if (fs.existsSync(monoPath)) {
      standaloneServer = monoPath;
      standaloneCwd = path.join(PATHS.web, '.next', 'standalone');
    } else if (fs.existsSync(directPath)) {
      standaloneServer = directPath;
      standaloneCwd = path.join(PATHS.web, '.next', 'standalone');
    }
  }

  if (!IS_DEV && standaloneServer && fs.existsSync(standaloneServer)) {
    // Modalità produzione: usa il server standalone auto-generato da next build
    const webProc = spawn(nodeBin, [standaloneServer], {
      cwd: standaloneCwd,
      env: { ...process.env, NODE_ENV: 'production', PORT: '3000', HOSTNAME: '0.0.0.0' },
      windowsHide: true,
    });
    processes.web = webProc;
    webProc.stdout.on('data', d => addLog(`[web] ${d.toString().trim()}`));
    webProc.stderr.on('data', d => { const m = d.toString().trim(); if (m) addLog(`[web] ${m}`); });
    webProc.on('exit', (code) => { addLog(`[web] Terminato (${code})`); processes.web = null; updateStatus(); });
  } else {
    // Modalità sviluppo o fallback: usa `next start` con binding su 0.0.0.0 (fondamentale per hotspot)
    const nextBin = IS_WIN
      ? path.join(PATHS.web, 'node_modules', '.bin', 'next.cmd')
      : path.join(PATHS.web, 'node_modules', '.bin', 'next');
    const webProc = spawn(nextBin, ['start', '-p', '3000', '-H', '0.0.0.0'], {
      cwd: PATHS.web,
      env: { ...process.env, NODE_ENV: 'production' },
      windowsHide: true,
      shell: IS_WIN,
    });
    processes.web = webProc;
    webProc.stdout.on('data', d => addLog(`[web] ${d.toString().trim()}`));
    webProc.stderr.on('data', d => { const m = d.toString().trim(); if (m) addLog(`[web] ${m}`); });
    webProc.on('exit', (code) => { addLog(`[web] Terminato (${code})`); processes.web = null; updateStatus(); });
  }


  // ── Print Agent locale ────────────────────────────────────────────────────
  const agentScript = IS_DEV
    ? path.join(PATHS.agent, 'src', 'index.ts')
    : path.join(PATHS.agent, 'dist', 'index.js');

  const agentEnv = {
    SERVER_URL: 'http://127.0.0.1:3001',
    AGENT_ID: `agent-server-${os.hostname()}`,
    STATION_ID: '',
  };

  if (IS_DEV) {
    const devBin = path.join(PATHS.agent, 'node_modules', '.bin', IS_WIN ? 'ts-node-dev.cmd' : 'ts-node-dev');
    const agentProc = spawn(devBin, ['--respawn', '--transpile-only', 'src/index.ts'], {
      cwd: PATHS.agent,
      env: { ...process.env, ...agentEnv },
      windowsHide: true,
    });
    processes.agent = agentProc;
    agentProc.stdout.on('data', d => addLog(`[agent] ${d.toString().trim()}`));
    agentProc.stderr.on('data', d => {
      const m = d.toString().trim();
      if (m && !m.includes('DeprecationWarning')) addLog(`[agent] ${m}`);
    });
    agentProc.on('exit', (code) => { addLog(`[agent] Terminato (${code})`); processes.agent = null; updateStatus(); });
  } else {
    startProcess('agent', nodeBin, agentScript, PATHS.agent, agentEnv);
  }

  // ── Aspetta Web App ───────────────────────────────────────────────────────
  addLog('⏳ Attendo che la Web App sia pronta (porta 3000)...');
  try {
    await waitForPort(3000, '127.0.0.1', 90000);
    addLog('✅ Web App pronta!');
  } catch {
    addLog('⚠️  Web App impiega più del solito ad avviarsi.');
  }

  updateStatus();
  addLog('🎉 SagraPOS avviato con successo!');

  // Apri browser
  setTimeout(() => shell.openExternal('http://localhost:3000'), 1500);
}

// ─── Sequenza avvio CLIENT ────────────────────────────────────────────────────
async function startClient(nodeBin) {
  const cfg = loadConfig();
  addLog(`🔗 Modalità CLIENT — Server: ${cfg.serverUrl}`);

  // ── Print Agent ───────────────────────────────────────────────────────────
  const agentScript = IS_DEV
    ? path.join(PATHS.agent, 'src', 'index.ts')
    : path.join(PATHS.agent, 'dist', 'index.js');

  const agentEnv = {
    SERVER_URL: cfg.serverUrl,
    AGENT_ID: `agent-${os.hostname().replace(/\s+/g, '-')}-${Date.now()}`,
    STATION_ID: cfg.stationId || '',
  };

  if (IS_DEV) {
    const devBin = path.join(PATHS.agent, 'node_modules', '.bin', IS_WIN ? 'ts-node-dev.cmd' : 'ts-node-dev');
    const agentProc = spawn(devBin, ['--respawn', '--transpile-only', 'src/index.ts'], {
      cwd: PATHS.agent,
      env: { ...process.env, ...agentEnv },
      windowsHide: true,
    });
    processes.agent = agentProc;
    agentProc.stdout.on('data', d => addLog(`[agent] ${d.toString().trim()}`));
    agentProc.on('exit', (code) => { addLog(`[agent] Terminato (${code})`); processes.agent = null; updateStatus(); });
  } else {
    startProcess('agent', nodeBin, agentScript, PATHS.agent, agentEnv);
  }

  updateStatus();

  // Apri browser sul server
  const serverBase = cfg.serverUrl.replace(':3001', ':3000').replace(/\/api$/, '');
  addLog(`🌐 Apertura browser su ${serverBase}...`);
  setTimeout(() => shell.openExternal(serverBase), 2000);
}

// ─── Ferma tutto ──────────────────────────────────────────────────────────────
function stopAll() {
  addLog('🛑 Arresto di tutti i servizi...');
  for (const [key, proc] of Object.entries(processes)) {
    if (proc) {
      try {
        if (IS_WIN) proc.kill();
        else proc.kill('SIGTERM');
      } catch {}
      processes[key] = null;
    }
  }
  updateStatus();
}

// ─── Crea finestra principale ─────────────────────────────────────────────────
function createMainWindow() {
  mainWin = new BrowserWindow({
    width: 720,
    height: 560,
    resizable: false,
    title: 'SagraPOS',
    backgroundColor: '#1d232a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    // nasconde la barra titolo su mac per look più pulito
    ...(IS_MAC ? { titleBarStyle: 'hiddenInset' } : {}),
  });

  mainWin.loadFile(path.join(PATHS.ui, 'index.html'));

  mainWin.on('close', e => {
    // Su Mac: minimize al tray invece di chiudere
    if (IS_MAC && tray) {
      e.preventDefault();
      mainWin.hide();
    }
  });

  mainWin.on('closed', () => { mainWin = null; });

  if (IS_DEV) mainWin.webContents.openDevTools({ mode: 'detach' });
}

// ─── Crea finestra setup ──────────────────────────────────────────────────────
function createSetupWindow() {
  setupWin = new BrowserWindow({
    width: 640,
    height: 500,
    resizable: false,
    title: 'SagraPOS — Configurazione',
    backgroundColor: '#1d232a',
    modal: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    ...(IS_MAC ? { titleBarStyle: 'hiddenInset' } : {}),
  });

  setupWin.loadFile(path.join(PATHS.ui, 'setup.html'));
  setupWin.on('closed', () => { setupWin = null; });
}

// ─── Tray icon ────────────────────────────────────────────────────────────────
function createTray() {
  const iconPath = path.join(__dirname, '..', 'build', IS_WIN ? 'icon.ico' : 'icon.png');
  let trayIcon;
  if (fs.existsSync(iconPath)) {
    trayIcon = nativeImage.createFromPath(iconPath);
    if (IS_MAC) trayIcon = trayIcon.resize({ width: 16, height: 16 });
  } else {
    trayIcon = nativeImage.createEmpty();
  }

  tray = new Tray(trayIcon);
  tray.setToolTip('SagraPOS');

  const menu = Menu.buildFromTemplate([
    { label: 'Apri SagraPOS', click: () => { if (mainWin) mainWin.show(); else createMainWindow(); } },
    { label: 'Apri Cassa nel Browser', click: () => {
      const cfg = loadConfig();
      const url = cfg.isServer ? 'http://localhost:3000' : cfg.serverUrl.replace(':3001', ':3000');
      shell.openExternal(url);
    }},
    { type: 'separator' },
    { label: 'Ferma tutti i servizi', click: stopAll },
    { type: 'separator' },
    { label: 'Esci', click: () => { stopAll(); app.quit(); } },
  ]);

  tray.setContextMenu(menu);
  tray.on('double-click', () => { if (mainWin) mainWin.show(); else createMainWindow(); });
}

// ─── IPC handlers ─────────────────────────────────────────────────────────────
ipcMain.handle('get-config', () => loadConfig());
ipcMain.handle('get-status', () => ({
  api:   !!processes.api,
  web:   !!processes.web,
  agent: !!processes.agent,
  localIPs: getLocalIPs(),
  config: loadConfig(),
}));
ipcMain.handle('get-logs', () => startupLogs);
ipcMain.handle('save-config', (_, data) => { saveConfig(data); return true; });

ipcMain.handle('start-all', async () => {
  const cfg = loadConfig();
  const nodeBin = findNode();

  if (!nodeBin) {
    dialog.showMessageBoxSync({
      type: 'error',
      title: 'Node.js non trovato',
      message: 'Node.js non è installato su questo computer.\n\nScaricalo gratis da: https://nodejs.org\nScegli la versione LTS.',
      buttons: ['Apri nodejs.org', 'Annulla'],
    });
    shell.openExternal('https://nodejs.org');
    return { ok: false, error: 'Node.js non trovato' };
  }

  try {
    if (cfg.isServer) {
      await startServer(nodeBin);
    } else {
      await startClient(nodeBin);
    }
    return { ok: true };
  } catch (e) {
    addLog(`❌ Errore avvio: ${e.message}`);
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('stop-all', () => { stopAll(); return true; });

ipcMain.handle('open-browser', () => {
  const cfg = loadConfig();
  const url = cfg.isServer ? 'http://localhost:3000' : cfg.serverUrl.replace(':3001', ':3000').replace(/\/api$/, '');
  shell.openExternal(url);
  return true;
});

ipcMain.handle('open-admin', () => {
  const cfg = loadConfig();
  const base = cfg.isServer ? 'http://localhost:3000' : cfg.serverUrl.replace(':3001', ':3000').replace(/\/api$/, '');
  shell.openExternal(`${base}/admin`);
  return true;
});

ipcMain.handle('open-setup-window', () => {
  if (!setupWin) createSetupWindow();
  else setupWin.focus();
  return true;
});

ipcMain.handle('complete-setup', async (_, data) => {
  // data: { isServer, serverUrl, stationId, stationName }
  saveConfig({ ...data, setupComplete: true });

  if (setupWin && !setupWin.isDestroyed()) setupWin.close();

  // Avvia i servizi
  if (!mainWin) createMainWindow();
  else mainWin.show();

  // Breve ritardo poi avvia
  setTimeout(async () => {
    if (mainWin) mainWin.webContents.send('starting');
    const nodeBin = findNode();
    if (nodeBin) {
      const cfg = loadConfig();
      if (cfg.isServer) await startServer(nodeBin);
      else await startClient(nodeBin);
    }
  }, 500);

  return true;
});

ipcMain.handle('test-server', async (_, url) => {
  return new Promise(resolve => {
    try {
      const u = new URL(url);
      const req = http.request({ hostname: u.hostname, port: u.port || 3001, path: '/health', timeout: 5000 }, res => {
        resolve({ ok: res.statusCode === 200 });
      });
      req.on('error', () => resolve({ ok: false }));
      req.on('timeout', () => { req.destroy(); resolve({ ok: false }); });
      req.end();
    } catch {
      resolve({ ok: false });
    }
  });
});

ipcMain.handle('reset-config', () => {
  try { fs.unlinkSync(PATHS.config); } catch {}
  stopAll();
  if (mainWin) mainWin.close();
  createSetupWindow();
  return true;
});

ipcMain.handle('get-node-info', () => {
  const bin = findNode();
  let version = null;
  if (bin) {
    try { version = execSync(`"${bin}" --version`, { encoding: 'utf8', timeout: 3000 }).trim(); } catch {}
  }
  return { found: !!bin, bin, version };
});

// ─── App lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  createTray();

  const cfg = loadConfig();

  if (!cfg.setupComplete) {
    // Prima volta: mostra wizard
    createSetupWindow();
  } else {
    // Utente già configurato: mostra dashboard e avvia
    createMainWindow();

    // Avvio automatico
    setTimeout(async () => {
      const nodeBin = findNode();
      if (nodeBin) {
        addLog('⚡ Avvio automatico...');
        if (cfg.isServer) await startServer(nodeBin);
        else await startClient(nodeBin);
      } else {
        addLog('⚠️  Node.js non trovato. Installa Node.js da https://nodejs.org');
      }
    }, 800);
  }
});

app.on('window-all-closed', () => {
  if (!IS_MAC) {
    stopAll();
    app.quit();
  }
});

app.on('activate', () => {
  if (!mainWin && !setupWin) {
    const cfg = loadConfig();
    if (cfg.setupComplete) createMainWindow();
    else createSetupWindow();
  }
});

app.on('before-quit', () => {
  stopAll();
});

// Previeni apertura multipla
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWin) { if (mainWin.isMinimized()) mainWin.restore(); mainWin.focus(); }
    else if (setupWin) setupWin.focus();
  });
}
