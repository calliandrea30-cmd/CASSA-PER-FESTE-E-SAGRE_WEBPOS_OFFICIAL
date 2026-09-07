"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const socket_io_client_1 = require("socket.io-client");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const dotenv = __importStar(require("dotenv"));
const net_1 = __importDefault(require("net"));
const http_1 = __importDefault(require("http"));
const child_process_1 = require("child_process");
const os_1 = __importDefault(require("os"));
// @ts-ignore
const escpos_1 = __importDefault(require("escpos"));
const usb_1 = require("usb");
// @ts-ignore
const { PNG } = require('pngjs');
dotenv.config();
// Default config
let config = {
    SERVER_URL: process.env.SERVER_URL || 'http://127.0.0.1:3001',
    STATION_ID: process.env.STATION_ID || '',
    AGENT_ID: process.env.AGENT_ID || `agent-${Date.now()}`,
    printers: [],
};
function getConfigPath() {
    const isPkg = typeof process.pkg !== 'undefined';
    if (isPkg)
        return path_1.default.join(path_1.default.dirname(process.execPath), 'config.json');
    const dirConfig = path_1.default.resolve(__dirname, '../config.json');
    if (fs_1.default.existsSync(dirConfig))
        return dirConfig;
    const cwdConfig = path_1.default.resolve(process.cwd(), 'config.json');
    if (fs_1.default.existsSync(cwdConfig))
        return cwdConfig;
    return dirConfig;
}
// Carica config.json
try {
    const configPath = getConfigPath();
    if (fs_1.default.existsSync(configPath)) {
        const fileConfig = JSON.parse(fs_1.default.readFileSync(configPath, 'utf8'));
        config = { ...config, ...fileConfig };
        console.log(`[Config] Caricato config.json da: ${configPath}`);
        console.log(`[Config] SERVER_URL: ${config.SERVER_URL}`);
        console.log(`[Config] STATION_ID: ${config.STATION_ID || '(non impostato — print agent in modalità broadcast)'}`);
    }
    else {
        console.warn(`[Config] config.json non trovato in ${configPath} — uso valori di default/env.`);
    }
}
catch (e) {
    console.warn('[Config] Errore lettura config.json:', e);
}
console.log(`[Boot] Print Agent (${config.AGENT_ID}) avviato. Server: ${config.SERVER_URL}`);
// ─── Health-check HTTP locale (porta 3002) ─────────────────────────────────────
// Consente al launcher Electron di verificare che l'agent sia attivo
// Usa una variabile che verrà impostata dopo la dichiarazione del socket
let socketRef = null;
const healthServer = http_1.default.createServer((req, res) => {
    // Gestione preflight CORS per consentire chiamate dal browser
    if (req.method === 'OPTIONS') {
        res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
        });
        res.end();
        return;
    }
    if (req.url === '/health') {
        res.writeHead(200, {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
        });
        res.end(JSON.stringify({
            status: 'ok',
            agentId: config.AGENT_ID,
            stationId: config.STATION_ID || null,
            serverUrl: config.SERVER_URL,
            connected: socketRef?.connected ?? false,
        }));
    }
    else if (req.url === '/set-station' && req.method === 'POST') {
        let body = '';
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', () => {
            try {
                const data = JSON.parse(body || '{}');
                if (data.stationId) {
                    const prevStation = config.STATION_ID;
                    config.STATION_ID = String(data.stationId).trim();
                    console.log(`[Config] Stazione print-agent sincronizzata: "${config.STATION_ID}" (${data.stationName || ''})`);
                    // Salva in config.json per persistere al prossimo riavvio
                    try {
                        const configPath = getConfigPath();
                        fs_1.default.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
                    }
                    catch (e) {
                        console.warn('[Config] Impossibile salvare config.json:', e.message);
                    }
                    // Notifica il server socket della nuova stazione se connesso
                    if (socketRef && socketRef.connected) {
                        const regData = { stationId: config.STATION_ID, agentId: config.AGENT_ID };
                        socketRef.emit('print-agent-register', regData);
                        socketRef.emit('register-print-agent', regData);
                    }
                }
                res.writeHead(200, {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                });
                res.end(JSON.stringify({ ok: true, stationId: config.STATION_ID }));
            }
            catch (err) {
                res.writeHead(400, {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                });
                res.end(JSON.stringify({ error: err.message || 'Dati non validi' }));
            }
        });
    }
    else {
        res.writeHead(404, { 'Access-Control-Allow-Origin': '*' });
        res.end();
    }
});
healthServer.listen(3002, '127.0.0.1', () => {
    console.log('[Health] Print Agent health check disponibile su http://127.0.0.1:3002/health');
});
healthServer.on('error', () => {
    // Porta già in uso — non critico
});
// ─── USB Adapter personalizzato ────────────────────────────────────────────────
class CustomUSBAdapter {
    device;
    endpoint;
    constructor(vid, pid) {
        const deviceList = (0, usb_1.getDeviceList)();
        this.device = deviceList.find((d) => d.deviceDescriptor.idVendor === vid &&
            d.deviceDescriptor.idProduct === pid);
        if (!this.device)
            throw new Error(`Stampante USB non trovata (VID:0x${vid.toString(16).toUpperCase()} PID:0x${pid.toString(16).toUpperCase()}). Controllare collegamento.`);
    }
    open(callback) {
        try {
            this.device.open();
            const iface = this.device.interfaces[0];
            if (iface.isKernelDriverActive && iface.isKernelDriverActive()) {
                iface.detachKernelDriver();
            }
            iface.claim();
            this.endpoint = iface.endpoints.find((e) => e.direction === 'out');
            if (!this.endpoint)
                throw new Error('Nessun endpoint OUT trovato sulla stampante USB.');
            callback(null);
        }
        catch (e) {
            callback(e);
        }
    }
    write(data, callback) {
        if (!this.endpoint)
            return callback(new Error('Dispositivo non aperto'));
        this.endpoint.transfer(data, (error) => callback(error));
        return this;
    }
    close(callback) {
        // Breve pausa per permettere al controller hardware della stampante di terminare la ricezione dei comandi prima della chiusura USB
        setTimeout(() => {
            try {
                if (this.device?.interfaces?.[0]) {
                    try {
                        this.device.interfaces[0].release(true, () => { });
                    }
                    catch { }
                }
                this.device?.close();
                if (callback)
                    callback(null);
            }
            catch (e) {
                if (callback)
                    callback(e);
            }
        }, 400);
        return this;
    }
}
escpos_1.default.USB = CustomUSBAdapter;
// ─── Network (ESC/POS over TCP) Adapter ───────────────────────────────────────
class NetworkPrinterAdapter {
    host;
    port;
    client = null;
    buffer = [];
    constructor(host, port = 9100) {
        this.host = host;
        this.port = port;
    }
    open(callback) {
        this.client = new net_1.default.Socket();
        this.client.connect(this.port, this.host, () => {
            console.log(`[Net Printer] Connesso a ${this.host}:${this.port}`);
            callback(null);
        });
        this.client.on('error', (err) => {
            console.error(`[Net Printer] Errore connessione a ${this.host}:${this.port}:`, err.message);
            callback(err);
        });
    }
    write(data, callback) {
        if (!this.client)
            return callback(new Error('Socket non aperto'));
        this.client.write(data, callback);
        return this;
    }
    close(callback) {
        if (this.client) {
            this.client.end(() => { if (callback)
                callback(null); });
            this.client = null;
        }
        else {
            if (callback)
                callback(null);
        }
        return this;
    }
}
// ─── Zero-Config: Rilevamento automatico stampante termica ────────────────────
// Vendor ID noti di stampanti termiche ESC/POS da 80mm / 58mm
const THERMAL_PRINTER_VENDORS = new Set([
    0x1fc9, // NXP / Xprinter / Zhuhai
    0x04b8, // Seiko Epson Corp.
    0x0416, // Winbond Electronics / POS-58/80
    0x0483, // STMicroelectronics / POS Thermal
    0x20d1, // Netum
    0x0519, // Star Micronics
    0x1504, // Bixolon
    0x0fe6, // ICS
    0x1a86, // Winchiphead (CH340 USB-Serial Thermal)
    0x0dd4, // Custom Engineering
    0x2730, // Citizen Systems
    0x6868, // Rongta
    0x0525, // Netchip
    0x0471, // Generic POS
]);
/** Cerca qualsiasi stampante termica USB collegata al computer senza richiedere configurazioni */
function findAnyUSBPrinter() {
    try {
        const list = (0, usb_1.getDeviceList)();
        // 1. Cerca prima dispositivi con Vendor ID noto di stampante termica
        for (const d of list) {
            const vid = d.deviceDescriptor?.idVendor;
            const pid = d.deviceDescriptor?.idProduct;
            if (vid && THERMAL_PRINTER_VENDORS.has(vid)) {
                return { vid, pid, device: d };
            }
        }
        // 2. Cerca dispositivi con USB Class 7 (Standard Printer Class)
        for (const d of list) {
            if (d.deviceDescriptor?.bDeviceClass === 7) {
                return { vid: d.deviceDescriptor.idVendor, pid: d.deviceDescriptor.idProduct, device: d };
            }
        }
    }
    catch (e) {
        console.warn('[Auto-Detect USB] Errore scansione:', e.message);
    }
    return null;
}
/** Enumera tutte le stampanti installate nel sistema operativo (macOS o Windows) */
function getAvailableSystemPrinters() {
    const isWin = process.platform === 'win32';
    try {
        if (isWin) {
            const cmd = 'powershell -NoProfile -Command "(Get-CimInstance Win32_Printer).Name"';
            const out = (0, child_process_1.execSync)(cmd, { encoding: 'utf8', timeout: 3000 });
            return out.split(/\r?\n/).map(p => p.trim()).filter(Boolean);
        }
        else {
            const out = (0, child_process_1.execSync)('lpstat -e 2>/dev/null || true', { encoding: 'utf8', timeout: 3000 });
            return out.split(/\r?\n/).map(p => p.trim()).filter(Boolean);
        }
    }
    catch {
        return [];
    }
}
/** Rileva la migliore stampante termica POS o la predefinita di sistema */
function getDefaultSystemPrinter() {
    const printers = getAvailableSystemPrinters();
    if (printers.length === 0)
        return null;
    // 1. Cerca prioritariamente una stampante POS / termica (es. Printer_POS_80, POS-80, XP-80, Thermal)
    const posPrinter = printers.find(p => /POS|80|58|Thermal|Receipt|Xprinter|Epson|Custom|Stampante|Scontrin/i.test(p));
    if (posPrinter)
        return posPrinter;
    // 2. Cerca la stampante predefinita di default del sistema operativo
    const isWin = process.platform === 'win32';
    try {
        if (isWin) {
            const cmdDef = 'powershell -NoProfile -Command "(Get-CimInstance Win32_Printer | Where-Object Default | Select-Object -First 1).Name"';
            const outDef = (0, child_process_1.execSync)(cmdDef, { encoding: 'utf8', timeout: 3000 }).trim();
            if (outDef && printers.includes(outDef))
                return outDef;
        }
        else {
            const dOut = (0, child_process_1.execSync)('lpstat -d 2>/dev/null || true', { encoding: 'utf8', timeout: 3000 });
            const dMatch = dOut.match(/:\s*([^\r\n]+)/);
            if (dMatch && dMatch[1] && !dMatch[1].toLowerCase().includes('nessuna') && !dMatch[1].toLowerCase().includes('no default')) {
                const def = dMatch[1].trim();
                if (printers.includes(def))
                    return def;
            }
        }
    }
    catch { }
    // 3. Fallback sulla prima stampante installata
    return printers[0];
}
/** Adapter che invia byte ESC/POS RAW direttamente alla stampante predefinita di sistema */
class SystemDefaultPrinterAdapter {
    buffer = [];
    printerName;
    constructor(printerName) {
        this.printerName = printerName || getDefaultSystemPrinter();
    }
    open(callback) {
        this.buffer = [];
        if (!this.printerName) {
            this.printerName = getDefaultSystemPrinter();
        }
        console.log(`[Default Printer] In ascolto su stampante di sistema: "${this.printerName || 'default'}"`);
        callback(null);
    }
    write(data, callback) {
        this.buffer.push(data);
        if (callback)
            callback(null);
        return this;
    }
    close(callback) {
        const fullBuffer = Buffer.concat(this.buffer);
        this.buffer = [];
        if (fullBuffer.length === 0) {
            if (callback)
                callback(null);
            return this;
        }
        const isWin = process.platform === 'win32';
        const tmpDir = os_1.default.tmpdir();
        const tmpFile = path_1.default.join(tmpDir, `sagrapos_job_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.raw`);
        try {
            fs_1.default.writeFileSync(tmpFile, fullBuffer);
            if (isWin) {
                // Su Windows usiamo lo script Win32 Spooler RAW per stampare fedelmente su qualsiasi stampante termica
                const candidates = [
                    path_1.default.join(__dirname, '../scripts/raw-print.ps1'),
                    path_1.default.join(__dirname, 'scripts/raw-print.ps1'),
                    path_1.default.join(process.cwd(), 'apps/print-agent/scripts/raw-print.ps1'),
                    path_1.default.join(process.cwd(), 'scripts/raw-print.ps1'),
                ];
                const psScript = candidates.find(p => fs_1.default.existsSync(p)) || candidates[0];
                const pArg = this.printerName ? `-PrinterName "${this.printerName}"` : '';
                const psCmd = `powershell -NoProfile -ExecutionPolicy Bypass -File "${psScript}" ${pArg} -FilePath "${tmpFile}"`;
                (0, child_process_1.execSync)(psCmd, { timeout: 10000 });
            }
            else {
                // macOS / Linux CUPS
                const available = getAvailableSystemPrinters();
                const isRealPrinter = Boolean(this.printerName && available.includes(this.printerName));
                const target = isRealPrinter ? this.printerName : getDefaultSystemPrinter();
                if (target) {
                    // Riabilita la coda di stampa se temporaneamente in pausa
                    try {
                        (0, child_process_1.execSync)(`cupsenable "${target}" 2>/dev/null || true`, { timeout: 2000 });
                    }
                    catch { }
                    (0, child_process_1.execSync)(`lpr -l -P "${target}" "${tmpFile}"`, { timeout: 8000 });
                }
                else {
                    try {
                        (0, child_process_1.execSync)(`lpr -l "${tmpFile}"`, { timeout: 5000 });
                    }
                    catch (e) {
                        console.warn('[CUPS] Nessuna stampante di sistema configurata su macOS/Linux:', e.message);
                    }
                }
            }
            console.log(`[Default Printer] ✅ Stampa inviata con successo (${fullBuffer.length} bytes alla stampante "${this.printerName || 'default'}")`);
            try {
                fs_1.default.unlinkSync(tmpFile);
            }
            catch { }
            if (callback)
                callback(null);
        }
        catch (err) {
            console.error('[Default Printer] Errore invio alla stampante di sistema:', err.message);
            try {
                fs_1.default.unlinkSync(tmpFile);
            }
            catch { }
            if (callback)
                callback(err);
        }
        return this;
    }
}
// ─── Helper: apri una stampante (con Auto-Detect e Fallback automatico) ────────
function openPrinterDevice(pc) {
    // 1. Se specificata stampante di rete TCP
    if (pc && pc.type === 'NETWORK' && pc.networkHost) {
        const adapter = new NetworkPrinterAdapter(pc.networkHost, pc.networkPort || 9100);
        return { device: adapter, isNetwork: true };
    }
    // 2. Se su macOS o Windows è presente una stampante termica/POS o di sistema (es. Printer_POS_80)
    // Usiamo prioritariamente l'adapter di sistema: è affidabile al 100%, non si disconnette e non confligge con i driver USB dell'OS
    const availablePrinters = getAvailableSystemPrinters();
    const isGenericDummy = !pc?.name ||
        ['stampante', 'predefinita', 'sistema', 'default', 'cassa', 'pos'].includes(pc.name.trim().toLowerCase());
    let targetPrinter = null;
    if (pc?.name && !isGenericDummy && availablePrinters.includes(pc.name)) {
        targetPrinter = pc.name;
    }
    else {
        targetPrinter = getDefaultSystemPrinter();
    }
    if (targetPrinter) {
        console.log(`[Auto-Detect] Stampante di sistema attiva selezionata: "${targetPrinter}"`);
        const sysAdapter = new SystemDefaultPrinterAdapter(targetPrinter);
        return { device: sysAdapter, isNetwork: false };
    }
    // 3. Se specificati Vendor ID e Product ID manuali (es. Linux senza spooler)
    if (pc && pc.usbVendorId && pc.usbProductId) {
        try {
            const adapter = new CustomUSBAdapter(pc.usbVendorId, pc.usbProductId);
            return { device: adapter, isNetwork: false };
        }
        catch (e) {
            console.warn(`[Printer] USB VID:0x${pc.usbVendorId.toString(16)} non aperto via USB diretta: ${e.message}`);
        }
    }
    // 4. ZERO-CONFIG: Cerca qualsiasi stampante termica USB collegata
    const anyUsb = findAnyUSBPrinter();
    if (anyUsb) {
        try {
            console.log(`[Auto-Detect] Trovata stampante termica USB: VID:0x${anyUsb.vid.toString(16)} PID:0x${anyUsb.pid.toString(16)}`);
            const adapter = new CustomUSBAdapter(anyUsb.vid, anyUsb.pid);
            return { device: adapter, isNetwork: false };
        }
        catch (e) {
            console.log(`[Auto-Detect] USB diretta non disponibile (${e.message}).`);
        }
    }
    // 5. Fallback finale
    const sysAdapter = new SystemDefaultPrinterAdapter();
    return { device: sysAdapter, isNetwork: false };
}
// ─── Helper: sceglie la stampante giusta (con default zero-config) ─────────────
function getPrinterConfigForRole(role, remotePrinters) {
    // 1. Cerca prima nella config locale (config.json)
    if (config.printers && config.printers.length > 0) {
        const local = config.printers.find(p => p.role === role);
        if (local)
            return local;
    }
    // 2. Cerca nel database
    const remote = remotePrinters?.find((p) => p.role === role);
    if (remote)
        return remote;
    // 3. ZERO-CONFIG DEFAULT: Ritorna la stampante termica predefinita di default
    const defName = getDefaultSystemPrinter() || undefined;
    return {
        type: 'USB',
        role: role,
        name: defName,
    };
}
// ─── Helpers stampa e formattazione colonne ─────────────────────────────────
function applySize(printer, sizeStr) {
    if (sizeStr === 'GIANT')
        printer.size(2, 2);
    else if (sizeStr === 'DOUBLE_HEIGHT')
        printer.size(0, 1);
    else
        printer.size(0, 0); // 0, 0 = 1x dimensione normale (NO ingrandimento 200%)
}
function formatTwoColumns(left, right, width = 32) {
    const r = String(right || '').trim();
    const maxLeft = Math.max(0, width - r.length - 1);
    const l = (left || '').length > maxLeft ? (left || '').substring(0, maxLeft) : (left || '');
    const spaces = Math.max(1, width - l.length - r.length);
    return l + ' '.repeat(spaces) + r;
}
/** Rasterizza e invia un'immagine PNG via comando ESC/POS GS v 0 (formato compatto ed elegante) */
function printRasterImage(printer, base64Data, maxWidth = 240) {
    if (!base64Data || typeof base64Data !== 'string')
        return;
    try {
        const cleanBase64 = base64Data.replace(/^data:image\/\w+;base64,/, '').trim();
        if (!cleanBase64)
            return;
        const rawBuffer = Buffer.from(cleanBase64, 'base64');
        const png = PNG.sync.read(rawBuffer);
        let targetWidth = png.width;
        let targetHeight = png.height;
        if (targetWidth > maxWidth) {
            const scale = maxWidth / targetWidth;
            targetWidth = maxWidth;
            targetHeight = Math.round(png.height * scale);
        }
        if (targetWidth <= 0 || targetHeight <= 0)
            return;
        const bytesWidth = Math.ceil(targetWidth / 8);
        const bitmap = Buffer.alloc(bytesWidth * targetHeight, 0);
        for (let y = 0; y < targetHeight; y++) {
            const srcY = Math.min(png.height - 1, Math.floor((y / targetHeight) * png.height));
            for (let x = 0; x < targetWidth; x++) {
                const srcX = Math.min(png.width - 1, Math.floor((x / targetWidth) * png.width));
                const idx = (png.width * srcY + srcX) << 2;
                const r = png.data[idx];
                const g = png.data[idx + 1];
                const b = png.data[idx + 2];
                const a = png.data[idx + 3];
                if (a < 128)
                    continue; // Trasparente = bianco
                const lum = 0.299 * r + 0.587 * g + 0.114 * b;
                if (lum < 160) {
                    bitmap[y * bytesWidth + (x >> 3)] |= (0x80 >> (x & 7));
                }
            }
        }
        const xL = bytesWidth & 0xff;
        const xH = (bytesWidth >> 8) & 0xff;
        const yL = targetHeight & 0xff;
        const yH = (targetHeight >> 8) & 0xff;
        // ESC a 1 (Centro) + GS v 0 (Stampa immagine raster)
        const header = Buffer.from([
            0x1b, 0x61, 0x01,
            0x1d, 0x76, 0x30, 0x00,
            xL, xH, yL, yH
        ]);
        const footer = Buffer.from([0x0a, 0x1b, 0x61, 0x00]);
        if (printer.raw) {
            printer.raw(header);
            printer.raw(bitmap);
            printer.raw(footer);
        }
    }
    catch (err) {
        console.warn('[Raster Image] Impossibile stampare immagine PNG:', err?.message || err);
    }
}
const DEFAULT_SETTINGS = {
    headerName: 'SAGRA',
    headerSubtitle: '',
    headerAddress: '',
    headerVat: '',
    headerPhone: '',
    headerAlign: 'ct',
    headerSize: 'NORMAL',
    headerLogoBase64: '',
    footerLogoBase64: '',
    bodyFont: 'b', // 'b' = carattere compatto salva-carta (default consigliato)
    showOriginalPrice: true,
    showChangeAndDiscount: true,
    dateFormat: 'SHORT',
    prepItemSize: 'NORMAL',
    prepNoteSize: 'NORMAL',
    prepShowMetadata: true,
    prepVariantFormat: 'BRACKETS',
    footerText: 'GRAZIE E ARRIVEDERCI!',
    comandaGreeting: '', // vuoto di default per risparmiare carta sui talloncini
    comandaShowHeader: false,
    comandaShowPrice: true,
    comandaShowGreeting: false,
    printToDepartments: false,
};
function getLineWidth(settings) {
    return settings?.bodyFont === 'a' ? 32 : 40;
}
function makeDashLine(width) {
    return '-'.repeat(width);
}
function makeEqLine(width) {
    return '='.repeat(width);
}
const LINE_EQ_32 = '='.repeat(32);
const LINE_DASH_32 = '-'.repeat(32);
/** Pulisce e sanitizza qualsiasi stringa per eliminare caratteri Unicode corrotti su stampanti termiche */
function cleanReceiptText(str) {
    if (!str)
        return '';
    return String(str)
        .replace(/[àáâãäå]/g, 'a')
        .replace(/[ÀÁÂÃÄÅ]/g, 'A')
        .replace(/[èéêë]/g, 'e')
        .replace(/[ÈÉÊË]/g, 'e')
        .replace(/[ìíîï]/g, 'i')
        .replace(/[ÌÍÎÏ]/g, 'I')
        .replace(/[òóôõö]/g, 'o')
        .replace(/[ÒÓÔÕÖ]/g, 'O')
        .replace(/[ùúûü]/g, 'u')
        .replace(/[ÙÚÛÜ]/g, 'U')
        .replace(/·/g, '-')
        .replace(/—/g, '-')
        .replace(/–/g, '-')
        .replace(/★/g, '*')
        .replace(/[’‘]/g, "'")
        .replace(/[“”]/g, '"')
        .trim();
}
/** Centra una riga su esattamente 'width' caratteri (utile solo per modalità allineamento a sinistra) */
function centerLine(text, width = 32) {
    const clean = cleanReceiptText(text);
    if (!clean)
        return '';
    if (clean.length >= width)
        return clean.substring(0, width);
    const pad = Math.floor((width - clean.length) / 2);
    return ' '.repeat(pad) + clean + ' '.repeat(width - clean.length - pad);
}
/** Allinea due colonne su esattamente 'width' caratteri (default 32 per rotoli termici 58mm/80mm) */
function alignTwoColumns(left, right, width = 32) {
    const l = cleanReceiptText(left).trim();
    const r = cleanReceiptText(right).trim();
    const maxLeft = Math.max(1, width - r.length - 1);
    const truncatedLeft = l.length > maxLeft ? l.substring(0, maxLeft) : l;
    const spaces = Math.max(1, width - truncatedLeft.length - r.length);
    return truncatedLeft + ' '.repeat(spaces) + r;
}
// ─── Stampa scontrino cliente compatto, centrato ed elegante ─────────────────
function printScontrino(printer, payload, settings) {
    // 1. Inizializzazione ESC/POS standard:
    // ESC @ : Reset stampante
    // ESC ! 0 : Carattere standard 1x (NO ingrandimento 200%)
    // ESC M 1 : Font B compatto ed elegante (salva 50% di carta)
    // ESC a 1 : Allineamento centrato hardware
    printer.pureText('\x1B\x40\x1B\x21\x00');
    if (settings.bodyFont === 'a') {
        printer.pureText('\x1B\x4D\x00'); // Font A
    }
    else {
        printer.pureText('\x1B\x4D\x01'); // Font B compatto salva-carta
    }
    printer.style('normal').align('ct');
    // Logo opzionale se presente
    if (settings.headerLogoBase64) {
        printRasterImage(printer, settings.headerLogoBase64, 240);
    }
    // Bordo superiore centrato
    printer.text(LINE_EQ_32);
    // Nome Attività / Evento in Grassetto centrato (1B 45 01)
    const name = cleanReceiptText(settings.headerName || 'SAGRA');
    if (name) {
        printer.style('b').text(name).style('normal');
    }
    // Eventuali dati aggiuntivi (indirizzo / associazione, P.IVA, telefono)
    const addr = settings.headerSubtitle || settings.headerAddress || '';
    if (addr) {
        addr.split('\n').map((l) => cleanReceiptText(l).trim()).filter(Boolean).forEach((line) => {
            printer.text(line);
        });
    }
    if (settings.headerVat) {
        printer.text(`P.IVA / C.F.: ${cleanReceiptText(settings.headerVat)}`);
    }
    if (settings.headerPhone) {
        printer.text(`Tel: ${cleanReceiptText(settings.headerPhone)}`);
    }
    // Data e Ora centrate
    const orderDate = new Date(payload.createdAt || Date.now());
    const dateStr = orderDate.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const timeStr = orderDate.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
    printer.text(`Data: ${dateStr} - Ora: ${timeStr}`);
    // Numero Ordine centrato in Grassetto
    const orderNumStr = String(payload.orderNumber || 0).padStart(4, '0');
    printer.style('b').text(`ORDINE #${orderNumStr}`).style('normal');
    // Tavolo o Cliente (se specificato e non generico/asporto)
    if (payload.customerName &&
        !payload.customerName.toLowerCase().includes('asporto') &&
        payload.customerName !== 'Asporto / Generico') {
        const tableLabel = payload.customerName.toUpperCase().startsWith('TAVOLO')
            ? payload.customerName.toUpperCase().replace(/^TAVOLO\s*/i, 'TAVOLO ')
            : `CLIENTE: ${cleanReceiptText(payload.customerName)}`;
        printer.text(tableLabel);
    }
    printer.text(LINE_DASH_32);
    // 2. Tabella Articoli: Allineamento a sinistra (1B 61 00), font compatto
    printer.align('lt');
    let subtotalCalc = 0;
    payload.items.forEach((item) => {
        const isOmaggio = (item.priceAtTime === 0 && (!payload.discount || payload.discount === 0)) ||
            (item.note && item.note.includes('OMAGGIO')) ||
            (item.variantName && item.variantName.includes('OMAGGIO'));
        const priceNum = isOmaggio ? 0 : item.priceAtTime * item.quantity;
        subtotalCalc += priceNum;
        const priceFormatted = isOmaggio ? 'OMAGGIO' : priceNum.toFixed(2).replace('.', ',');
        let itemDesc = `${item.quantity}x ${cleanReceiptText(item.product?.name || 'Articolo').toUpperCase()}`;
        if (item.quantity > 1 && item.priceAtTime > 0 && !isOmaggio) {
            const unitStr = `(E ${item.priceAtTime.toFixed(2).replace('.', ',')})`;
            if (itemDesc.length + unitStr.length + 1 <= 32 - priceFormatted.length - 1) {
                itemDesc += ` ${unitStr}`;
            }
        }
        printer.text(alignTwoColumns(itemDesc, priceFormatted, 32));
        // Dettaglio varianti o note con asterisco
        const cleanVariant = item.variantName && !item.variantName.includes('OMAGGIO') ? cleanReceiptText(item.variantName) : '';
        const cleanNote = cleanReceiptText((item.note || '').replace(/\[OMAGGIO\]/g, ''));
        if (cleanVariant || cleanNote) {
            const detail = [cleanVariant, cleanNote].filter(Boolean).join(' - ');
            printer.text(`   * ${detail}`);
        }
        // Combo items
        if (item.product?.isCombo && item.product?.comboItems) {
            item.product.comboItems.forEach((cItem) => {
                printer.text(`   - ${cItem.quantity * item.quantity}x ${cleanReceiptText(cItem.component?.name || 'Componente')}`);
            });
        }
    });
    printer.text(LINE_DASH_32);
    // 3. Eventuale Subtotale e Sconto
    if (payload.discount && Number(payload.discount) > 0) {
        const subFormatted = subtotalCalc.toFixed(2).replace('.', ',');
        printer.text(alignTwoColumns('SUBTOTALE', `E ${subFormatted}`, 32));
        const scontoFormatted = Number(payload.discount).toFixed(2).replace('.', ',');
        printer.text(alignTwoColumns('SCONTO', `-E ${scontoFormatted}`, 32));
        printer.text(LINE_DASH_32);
    }
    // 4. Totale Centrato in Grassetto (1B 61 01 + 1B 45 01)
    const totFormatted = Number(payload.totalAmount || 0).toFixed(2).replace('.', ',');
    printer.align('ct').style('b');
    printer.text(`TOTALE: E ${totFormatted}`);
    printer.style('normal');
    // 5. Pagamento centrato
    const paymentMethod = payload.paymentType === 'CARD' ? 'PAGAMENTO: POS' : 'PAGAMENTO: CONTANTI';
    printer.text(paymentMethod);
    printer.text(LINE_DASH_32);
    // 6. Ringraziamento finale centrato (1B 61 01)
    const footer = cleanReceiptText(settings.footerText || 'Grazie e Arrivederci!');
    if (footer) {
        footer.split('\n').map((l) => l.trim()).filter(Boolean).forEach((line) => {
            printer.text(line);
        });
    }
    if (settings.footerLogoBase64) {
        printRasterImage(printer, settings.footerLogoBase64, 240);
    }
    // 7. Bordo finale, avanzamento 4 righe (1B 64 04) e taglio carta (1D 56 42 00)
    printer.text(LINE_EQ_32);
    printer.pureText('\x1B\x64\x04\x1D\x56\x42\x00');
}
// ─── Stampa talloncini comanda compatti e ordinati (Salva-Carta) ─────────────
function printComande(printer, payload, settings, categoryFilter) {
    // Se la stampa talloncini per articolo alla cassa è disabilitata, non stampare nulla
    if (settings.comandaShowHeader === false)
        return;
    const prepList = [];
    payload.items.forEach((item) => {
        const catName = item.product?.category?.name || 'Generico';
        if (item.product?.isCombo && item.product?.comboItems) {
            item.product.comboItems.forEach((cItem) => {
                for (let i = 0; i < item.quantity * cItem.quantity; i++) {
                    prepList.push({
                        name: cItem.component?.name || 'Prodotto',
                        variantName: item.variantName,
                        categoryName: cItem.component?.category?.name || catName,
                        comboName: item.product.name,
                        note: item.note,
                        priceAtTime: item.priceAtTime,
                    });
                }
            });
        }
        else {
            for (let i = 0; i < item.quantity; i++) {
                prepList.push({
                    name: item.product?.name || 'Articolo',
                    variantName: item.variantName,
                    categoryName: catName,
                    comboName: null,
                    note: item.note,
                    priceAtTime: item.priceAtTime,
                });
            }
        }
    });
    const filtered = categoryFilter
        ? prepList.filter(p => p.categoryName.toLowerCase().includes(categoryFilter.toLowerCase()))
        : prepList;
    if (filtered.length === 0)
        return;
    const orderNumStr = String(payload.orderNumber || 0).padStart(4, '0');
    const timeStr = new Date(payload.createdAt || Date.now()).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
    let tableLabel = '';
    if (payload.customerName &&
        !payload.customerName.toLowerCase().includes('asporto') &&
        payload.customerName !== 'Asporto / Generico') {
        tableLabel = payload.customerName.toUpperCase().replace(/^TAVOLO\s*/i, 'TAVOLO ');
    }
    filtered.forEach((prep) => {
        // Inizializzazione ESC/POS: Font A (standard 12x24, leggermente più grande e nitido di Font B)
        printer.pureText('\x1B\x40\x1B\x21\x00\x1B\x4D\x00');
        printer.style('normal').align('ct');
        printer.text(LINE_EQ_32);
        // Numero ordine leggermente ingrandito (Double-Height) e in grassetto per massima visibilità
        printer.size(0, 1).style('b').text(`ORDINE #${orderNumStr}`).size(0, 0).style('normal');
        printer.text(timeStr);
        if (tableLabel) {
            printer.style('b').text(tableLabel).style('normal');
        }
        printer.text(LINE_DASH_32);
        // Articolo in risalto (Double-Height in grassetto, ben visibile ma senza andare a capo inutilmente)
        printer.size(0, 1).style('b').text(`1x ${cleanReceiptText(prep.name).toUpperCase()}`).size(0, 0).style('normal');
        // Varianti o note (in Font A standard in grassetto, nitide)
        const cleanVariant = prep.variantName && !prep.variantName.includes('OMAGGIO') ? cleanReceiptText(prep.variantName) : '';
        const cleanNote = cleanReceiptText((prep.note || '').replace(/\[OMAGGIO\]/g, ''));
        if (cleanVariant || cleanNote) {
            const detail = [cleanVariant, cleanNote].filter(Boolean).join(' - ');
            printer.style('b').text(`* ${detail}`).style('normal');
        }
        if (prep.comboName) {
            printer.text(`[Menu: ${cleanReceiptText(prep.comboName)}]`);
        }
        if (settings.comandaShowPrice !== false && typeof prep.priceAtTime === 'number' && prep.priceAtTime > 0) {
            printer.style('b').text(`E ${prep.priceAtTime.toFixed(2).replace('.', ',')}`).style('normal');
        }
        printer.text(LINE_DASH_32);
        printer.pureText('\x1B\x64\x04\x1D\x56\x42\x00');
    });
}
// ─── Esegui stampa su un adapter ──────────────────────────────────────────────
function printOnAdapter(printerConfig, renderFn, onDone) {
    let device;
    try {
        const { device: d } = openPrinterDevice(printerConfig);
        device = d;
    }
    catch (e) {
        console.error(`[Printer] Impossibile aprire ${printerConfig.name || printerConfig.type}:`, e.message);
        return onDone(e);
    }
    device.open((openErr) => {
        if (openErr) {
            console.warn(`[Printer] Errore apertura ${printerConfig.name || 'dispositivo'} (${openErr.message || openErr}). Tento fallback su stampante di sistema...`);
            const fallbackAdapter = new SystemDefaultPrinterAdapter();
            fallbackAdapter.open((fallbackErr) => {
                if (fallbackErr) {
                    console.error('[Printer] Fallback su stampante di sistema fallito:', fallbackErr.message || fallbackErr);
                    return onDone(openErr);
                }
                const fallbackPrinter = new escpos_1.default.Printer(fallbackAdapter, { encoding: 'CP858' });
                try {
                    renderFn(fallbackPrinter);
                }
                catch (e) {
                    console.error('[Printer] Errore rendering stampa (fallback):', e.message);
                }
                fallbackPrinter.close(() => {
                    console.log('[Printer] ✅ Job completato via fallback su stampante di sistema');
                    onDone(null);
                });
            });
            return;
        }
        const printer = new escpos_1.default.Printer(device, { encoding: 'CP858' });
        console.log(`[Printer] ✅ Stampa su "${printerConfig.name}" (${printerConfig.type === 'NETWORK' ? printerConfig.networkHost : `USB VID:${printerConfig.usbVendorId?.toString(16)}`})`);
        try {
            renderFn(printer);
        }
        catch (e) {
            console.error('[Printer] Errore rendering stampa:', e.message);
        }
        printer.close(() => {
            console.log(`[Printer] ✅ Job completato su "${printerConfig.name}"`);
            onDone(null);
        });
    });
}
// ─── Invia ACK al server ───────────────────────────────────────────────────────
async function sendAck(jobId, status, errorMsg) {
    try {
        await fetch(`${config.SERVER_URL}/api/print-jobs/${jobId}/ack`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status, errorMsg }),
        });
    }
    catch (e) {
        console.warn(`[Ack] Invio fallito: ${e.message}`);
    }
}
// ─── Polling di recovery per job non stampati quando l'agent era offline ───────
async function fetchPendingJobs() {
    try {
        const res = await fetch(`${config.SERVER_URL}/api/print-jobs/pending?stationId=${config.STATION_ID || ''}`);
        if (!res.ok)
            return [];
        const data = await res.json();
        return Array.isArray(data) ? data : (data.jobs || []);
    }
    catch {
        return [];
    }
}
// ─── Connessione WebSocket e registrazione ─────────────────────────────────────
const socket = (0, socket_io_client_1.io)(config.SERVER_URL, {
    reconnection: true,
    reconnectionDelay: 5000,
    reconnectionDelayMax: 30000,
    reconnectionAttempts: Infinity,
    timeout: 10000,
});
// Aggiorna il riferimento per il health-check HTTP
socketRef = socket;
socket.on('connect_error', () => {
    console.log(`[Rete] Server non raggiungibile (${config.SERVER_URL}). Riprovo...`);
});
socket.on('connect', async () => {
    console.log(`[Socket] Connesso al server: ${config.SERVER_URL}`);
    // Invia handshake con entrambi i nomi per massima compatibilità
    const regData = {
        stationId: config.STATION_ID,
        agentId: config.AGENT_ID,
    };
    socket.emit('print-agent-register', regData);
    socket.emit('register-print-agent', regData);
    // Recupera i job in attesa che erano stati emessi mentre questo agent era offline
    const pendingJobs = await fetchPendingJobs();
    if (pendingJobs.length > 0) {
        console.log(`[Recovery] ${pendingJobs.length} job in attesa da processare...`);
        for (const job of pendingJobs) {
            await processJob(job);
        }
    }
});
socket.on('disconnect', (reason) => {
    console.log(`[Socket] Disconnesso: ${reason}`);
});
socket.on('print-agent-ack', (data) => {
    console.log(`[Server] Registrazione confermata per stazione: ${data.stationId}`);
});
// Set per deduplicazione: evita doppie stampe dovute a ricezione broadcast + stanza dedicata
const processedJobIds = new Set();
// ─── Processing del job ───────────────────────────────────────────────────────
async function processJob(job) {
    if (!job)
        return;
    if (job.id && processedJobIds.has(job.id)) {
        console.log(`[Job] Skip: job ${job.id} già elaborato (deduplicazione socket)`);
        return;
    }
    if (job.id) {
        processedJobIds.add(job.id);
        if (processedJobIds.size > 500) {
            const first = processedJobIds.values().next().value;
            if (first)
                processedJobIds.delete(first);
        }
    }
    console.log(`\n[Job] ====== PROCESSING JOB ${job.id} (${job.printerId || 'generic'}) ======`);
    // Filtro per stazione: se il job ha una stationId e noi abbiamo una STATION_ID configurata,
    // processiamo solo i job della nostra stazione o quelli senza stazione (broadcast).
    if (config.STATION_ID && job.stationId && job.stationId !== config.STATION_ID) {
        // Per il ruolo KITCHEN/BAR/PREP possiamo processare tutti (comande)
        const isComandaJob = job.printerId && job.printerId !== 'CASHIER';
        if (!isComandaJob) {
            console.log(`[Job] Skip: job per stazione ${job.stationId}, siamo ${config.STATION_ID}`);
            return;
        }
    }
    let payload;
    try {
        payload = JSON.parse(job.payload);
    }
    catch (e) {
        console.error('[Job] Payload JSON non valido:', e);
        await sendAck(job.id, 'ERROR', 'Payload JSON non valido');
        return;
    }
    const settings = { ...DEFAULT_SETTINGS, ...(payload.settings || {}) };
    // Stampanti disponibili: prima quelle del payload (dal DB), poi quelle locali in config
    const remotePrinters = payload.printerConfigs || [];
    try {
        if (payload.type === 'REPORT_X' || payload.type === 'REPORT_Z') {
            // Stampa su stampante CASHIER
            const printerConfig = getPrinterConfigForRole('CASHIER', remotePrinters);
            if (!printerConfig) {
                console.warn('[Job] Nessuna stampante CASHIER configurata per il report.');
                await sendAck(job.id, 'ERROR', 'Nessuna stampante CASHIER configurata');
                return;
            }
            await new Promise((resolve) => {
                printOnAdapter(printerConfig, (printer) => {
                    const report = payload.reportData || {};
                    printer.pureText('\x1B\x40\x1B\x21\x00\x1B\x4D\x01');
                    printer.style('normal').align('lt');
                    printer.text(LINE_EQ_32);
                    const title = payload.type === 'REPORT_Z' ? 'CHIUSURA DI CASSA Z' : 'LETTURA X (RESOCONTO)';
                    printer.text(centerLine(title, 32));
                    printer.text(LINE_EQ_32);
                    const dateStr = new Date().toLocaleDateString('it-IT');
                    const timeStr = new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
                    printer.text(alignTwoColumns(`Data: ${dateStr}`, `Ora: ${timeStr}`, 32));
                    if (report.openedAt) {
                        printer.text(alignTwoColumns('Apertura:', new Date(report.openedAt).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }), 32));
                    }
                    printer.text(alignTwoColumns('Ordini totali:', String(report.orderCount || 0), 32));
                    printer.text(LINE_DASH_32);
                    printer.style('b').text(alignTwoColumns('INCASSO LORDO', `E ${(report.totalGross || 0).toFixed(2)}`, 32)).style('normal');
                    if (report.totalDiscount && Number(report.totalDiscount) > 0) {
                        printer.text(alignTwoColumns('SCONTI TOTALI', `-E ${Number(report.totalDiscount).toFixed(2)}`, 32));
                    }
                    if (report.paymentBreakdown) {
                        printer.text(alignTwoColumns('  Di cui Contanti:', `E ${(report.paymentBreakdown.CASH || 0).toFixed(2)}`, 32));
                        printer.text(alignTwoColumns('  Di cui Carta/POS:', `E ${(report.paymentBreakdown.CARD || 0).toFixed(2)}`, 32));
                    }
                    printer.text(LINE_DASH_32);
                    printer.style('b').text(alignTwoColumns('INCASSO NETTO', `E ${(report.totalNet || 0).toFixed(2)}`, 32)).style('normal');
                    printer.text(LINE_DASH_32);
                    if (report.categoryBreakdown && Object.keys(report.categoryBreakdown).length > 0) {
                        printer.text(centerLine('VENDITE PER REPARTO', 32));
                        Object.entries(report.categoryBreakdown).forEach(([cat, amount]) => {
                            printer.text(alignTwoColumns(cleanReceiptText(cat), `E ${Number(amount).toFixed(2)}`, 32));
                        });
                        printer.text(LINE_DASH_32);
                    }
                    if (report.productStats && Object.keys(report.productStats).length > 0) {
                        printer.text(centerLine('ARTICOLI VENDUTI', 32));
                        Object.entries(report.productStats).forEach(([prod, stat]) => {
                            printer.text(alignTwoColumns(`${stat.qty}x ${cleanReceiptText(prod)}`, `E ${Number(stat.total).toFixed(2)}`, 32));
                        });
                        printer.text(LINE_DASH_32);
                    }
                    printer.text(LINE_EQ_32);
                    const endMsg = payload.type === 'REPORT_Z' ? '*** FINE CHIUSURA Z ***' : '*** FINE LETTURA X ***';
                    printer.text(centerLine(endMsg, 32));
                    printer.text(LINE_EQ_32);
                    printer.pureText('\x1B\x64\x04\x1D\x56\x42\x00');
                }, resolve);
            });
            await sendAck(job.id, 'PRINTED');
        }
        else if (payload.type === 'STORNO') {
            const order = payload.order;
            const printerConfig = getPrinterConfigForRole('CASHIER', remotePrinters);
            if (!printerConfig) {
                console.warn('[Job] Nessuna stampante CASHIER per storno.');
                await sendAck(job.id, 'ERROR', 'Nessuna stampante CASHIER');
                return;
            }
            await new Promise((resolve) => {
                printOnAdapter(printerConfig, (printer) => {
                    printer.pureText('\x1B\x40\x1B\x21\x00\x1B\x4D\x01');
                    printer.style('normal').align('lt');
                    printer.text(LINE_EQ_32);
                    printer.text(centerLine('STORNO ORDINE', 32));
                    printer.text(LINE_EQ_32);
                    printer.text(alignTwoColumns('ORD. ORIGINALE:', `#${order.orderNumber}`, 32));
                    printer.text(alignTwoColumns('DATA STORNATO:', new Date().toLocaleDateString('it-IT'), 32));
                    printer.text(LINE_DASH_32);
                    order.items.forEach((item) => {
                        const varName = item.variantName ? ` [${cleanReceiptText(item.variantName)}]` : '';
                        const line = `-${item.quantity}x ${cleanReceiptText(item.product.name)}${varName}`;
                        const total = `-${(item.priceAtTime * item.quantity).toFixed(2)}`;
                        printer.text(alignTwoColumns(line, total, 32));
                    });
                    printer.text(LINE_DASH_32);
                    printer.style('b').text(alignTwoColumns('TOTALE STORNO:', `-E ${order.totalAmount.toFixed(2)}`, 32)).style('normal');
                    printer.text(LINE_EQ_32);
                    printer.pureText('\x1B\x64\x04\x1D\x56\x42\x00');
                }, resolve);
            });
            await sendAck(job.id, 'PRINTED');
        }
        else {
            // Ordine normale: scontrino + comande
            const isCashierJob = job.printerId === 'CASHIER' || !job.printerId;
            const isKitchenJob = job.printerId !== 'CASHIER';
            if (isCashierJob) {
                // ── ALLA CASSA: Stampa biglietto riepilogativo + biglietto per ciascun articolo ──
                const printerConfig = getPrinterConfigForRole('CASHIER', remotePrinters);
                await new Promise((resolve) => {
                    printOnAdapter(printerConfig, (printer) => {
                        // 1. Biglietto riepilogativo per il cliente (totale, sconti, articoli, pagamento)
                        printScontrino(printer, payload, settings);
                        // 2. Biglietto per ciascun articolo ordinato (solo se abilitato)
                        if (settings.comandaShowHeader !== false) {
                            printComande(printer, payload, settings);
                        }
                    }, resolve);
                });
            }
            else if (isKitchenJob) {
                // ── DISTRETTI REMOTI: Stampa solo su stampanti dedicate di reparto (Cucina, Bar) ──
                const kitchenConfig = getPrinterConfigForRole('KITCHEN', remotePrinters);
                const barConfig = getPrinterConfigForRole('BAR', remotePrinters);
                const prepConfig = getPrinterConfigForRole('PREP', remotePrinters);
                // Raggruppa i prodotti per categoria e stampa sul reparto corretto
                const printers = [
                    ...(kitchenConfig ? [{ config: kitchenConfig, filter: 'cucina' }] : []),
                    ...(barConfig ? [{ config: barConfig, filter: 'bar' }] : []),
                    ...(prepConfig ? [{ config: prepConfig, filter: '' }] : []),
                ];
                for (const { config: pc, filter } of printers) {
                    await new Promise((resolve) => {
                        printOnAdapter(pc, (printer) => printComande(printer, payload, settings, filter || undefined), resolve);
                    });
                }
            }
            await sendAck(job.id, 'PRINTED');
        }
    }
    catch (e) {
        console.error(`[Job] Errore processing:`, e.message || e);
        await sendAck(job.id, 'ERROR', e?.message || 'Errore sconosciuto');
    }
}
// ─── Listener print-job ───────────────────────────────────────────────────────
socket.on('print-job', async (job) => {
    await processJob(job);
});
