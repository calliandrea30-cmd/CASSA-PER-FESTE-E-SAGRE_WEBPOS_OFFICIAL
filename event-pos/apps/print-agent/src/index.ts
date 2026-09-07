import { io } from 'socket.io-client';
import fs from 'fs';
import path from 'path';
import * as dotenv from 'dotenv';
import net from 'net';
import http from 'http';
import { execSync } from 'child_process';
import os from 'os';
// @ts-ignore
import escpos from 'escpos';
import { getDeviceList } from 'usb';
// @ts-ignore
const { PNG } = require('pngjs');

dotenv.config();

// ─── Configurazione ────────────────────────────────────────────────────────────
interface PrinterConfig {
  type: 'USB' | 'NETWORK';
  role: string;
  name?: string;
  usbVendorId?: number;
  usbProductId?: number;
  networkHost?: string;
  networkPort?: number;
}

interface Config {
  SERVER_URL: string;
  STATION_ID: string;
  AGENT_ID: string;
  /** Stampanti configurate localmente (override del DB) */
  printers?: PrinterConfig[];
}

// Default config
let config: Config = {
  SERVER_URL: process.env.SERVER_URL || 'http://127.0.0.1:3001',
  STATION_ID: process.env.STATION_ID || '',
  AGENT_ID:   process.env.AGENT_ID   || `agent-${Date.now()}`,
  printers: [],
};

// Carica config.json dalla stessa directory dell'eseguibile
try {
  const isPkg = typeof (process as any).pkg !== 'undefined';
  const configPath = path.join(
    isPkg ? path.dirname(process.execPath) : process.cwd(),
    'config.json',
  );
  if (fs.existsSync(configPath)) {
    const fileConfig: Partial<Config> = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    config = { ...config, ...fileConfig };
    console.log(`[Config] Caricato config.json da: ${configPath}`);
    console.log(`[Config] SERVER_URL: ${config.SERVER_URL}`);
    console.log(`[Config] STATION_ID: ${config.STATION_ID || '(non impostato — print agent in modalità broadcast)'}`);
  } else {
    console.warn(`[Config] config.json non trovato in ${configPath} — uso valori di default/env.`);
  }
} catch (e) {
  console.warn('[Config] Errore lettura config.json:', e);
}

console.log(`[Boot] Print Agent (${config.AGENT_ID}) avviato. Server: ${config.SERVER_URL}`);

// ─── Health-check HTTP locale (porta 3002) ─────────────────────────────────────
// Consente al launcher Electron di verificare che l'agent sia attivo
// Usa una variabile che verrà impostata dopo la dichiarazione del socket
let socketRef: any = null;

const healthServer = http.createServer((req: any, res: any) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      agentId: config.AGENT_ID,
      stationId: config.STATION_ID || null,
      serverUrl: config.SERVER_URL,
      connected: socketRef?.connected ?? false,
    }));
  } else {
    res.writeHead(404);
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
  device: any;
  endpoint: any;

  constructor(vid: number, pid: number) {
    const deviceList = getDeviceList();
    this.device = deviceList.find(
      (d: any) =>
        d.deviceDescriptor.idVendor === vid &&
        d.deviceDescriptor.idProduct === pid,
    );
    if (!this.device)
      throw new Error(
        `Stampante USB non trovata (VID:0x${vid.toString(16).toUpperCase()} PID:0x${pid.toString(16).toUpperCase()}). Controllare collegamento.`,
      );
  }

  open(callback: (err?: any) => void) {
    try {
      this.device.open();
      const iface = this.device.interfaces[0];
      if (iface.isKernelDriverActive && iface.isKernelDriverActive()) {
        iface.detachKernelDriver();
      }
      iface.claim();
      this.endpoint = iface.endpoints.find((e: any) => e.direction === 'out');
      if (!this.endpoint) throw new Error('Nessun endpoint OUT trovato sulla stampante USB.');
      callback(null);
    } catch (e) {
      callback(e);
    }
  }

  write(data: Buffer, callback: (err?: any) => void) {
    if (!this.endpoint) return callback(new Error('Dispositivo non aperto'));
    this.endpoint.transfer(data, (error: any) => callback(error));
    return this;
  }

  close(callback?: (err?: any) => void) {
    try {
      if (this.device?.interfaces?.[0]) {
        try { this.device.interfaces[0].release(true, () => {}); } catch {}
      }
      this.device?.close();
      if (callback) callback(null);
    } catch (e) {
      if (callback) callback(e);
    }
    return this;
  }
}

escpos.USB = CustomUSBAdapter;

// ─── Network (ESC/POS over TCP) Adapter ───────────────────────────────────────
class NetworkPrinterAdapter {
  private host: string;
  private port: number;
  private client: net.Socket | null = null;
  private buffer: Buffer[] = [];

  constructor(host: string, port: number = 9100) {
    this.host = host;
    this.port = port;
  }

  open(callback: (err?: any) => void) {
    this.client = new net.Socket();
    this.client.connect(this.port, this.host, () => {
      console.log(`[Net Printer] Connesso a ${this.host}:${this.port}`);
      callback(null);
    });
    this.client.on('error', (err) => {
      console.error(`[Net Printer] Errore connessione a ${this.host}:${this.port}:`, err.message);
      callback(err);
    });
  }

  write(data: Buffer, callback: (err?: any) => void) {
    if (!this.client) return callback(new Error('Socket non aperto'));
    this.client.write(data, callback as any);
    return this;
  }

  close(callback?: (err?: any) => void) {
    if (this.client) {
      this.client.end(() => { if (callback) callback(null); });
      this.client = null;
    } else {
      if (callback) callback(null);
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
function findAnyUSBPrinter(): { vid: number; pid: number; device: any } | null {
  try {
    const list = getDeviceList();
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
  } catch (e: any) {
    console.warn('[Auto-Detect USB] Errore scansione:', e.message);
  }
  return null;
}

/** Rileva la stampante predefinita di default del sistema operativo (macOS o Windows) */
function getDefaultSystemPrinter(): string | null {
  const isWin = process.platform === 'win32';
  try {
    if (isWin) {
      const cmd = 'powershell -NoProfile -Command "(Get-CimInstance Win32_Printer | Where-Object Default).Name"';
      const out = execSync(cmd, { encoding: 'utf8', timeout: 3000 }).trim();
      return out || null;
    } else {
      // macOS / Linux CUPS
      const out = execSync('lpstat -d 2>/dev/null || true', { encoding: 'utf8', timeout: 3000 });
      const match = out.match(/:\s*([^\r\n]+)/);
      if (match && match[1]) {
        return match[1].trim();
      }
      // Fallback: cerca stampante contenente POS, 80 o Thermal in lpstat -p
      const pOut = execSync('lpstat -p 2>/dev/null || true', { encoding: 'utf8', timeout: 3000 });
      const posMatch = pOut.match(/(?:printer|stampante)\s+([^\s]+(?:POS|80|Receipt|Thermal)[^\s]*)/i);
      if (posMatch) {
        return (posMatch[1] || '').trim();
      }
    }
  } catch {}
  return null;
}

/** Adapter che invia byte ESC/POS RAW direttamente alla stampante predefinita di sistema */
class SystemDefaultPrinterAdapter {
  private buffer: Buffer[] = [];
  private printerName: string | null;

  constructor(printerName?: string) {
    this.printerName = printerName || getDefaultSystemPrinter();
  }

  open(callback: (err?: any) => void) {
    this.buffer = [];
    if (!this.printerName) {
      this.printerName = getDefaultSystemPrinter();
    }
    console.log(`[Default Printer] In ascolto su stampante predefinita di sistema: "${this.printerName || 'default'}"`);
    callback(null);
  }

  write(data: Buffer, callback: (err?: any) => void) {
    this.buffer.push(data);
    if (callback) callback(null);
    return this;
  }

  close(callback?: (err?: any) => void) {
    const fullBuffer = Buffer.concat(this.buffer);
    this.buffer = [];

    if (fullBuffer.length === 0) {
      if (callback) callback(null);
      return this;
    }

    const isWin = process.platform === 'win32';
    const tmpDir = os.tmpdir();
    const tmpFile = path.join(tmpDir, `sagrapos_job_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.raw`);

    try {
      fs.writeFileSync(tmpFile, fullBuffer);

      if (isWin) {
        const pName = this.printerName ? `"${this.printerName}"` : '(Get-CimInstance Win32_Printer | Where-Object Default).Name';
        const psCmd = `powershell -NoProfile -Command "$p = ${pName}; [System.IO.File]::ReadAllBytes('${tmpFile}') | Out-Printer -Name $p"`;
        execSync(psCmd, { timeout: 8000 });
      } else {
        const target = this.printerName || getDefaultSystemPrinter();
        const lpCmd = target
          ? `lpr -l -P "${target}" "${tmpFile}"`
          : `lpr -l "${tmpFile}"`;
        execSync(lpCmd, { timeout: 8000 });
      }

      console.log(`[Default Printer] ✅ Stampa inviata con successo (${fullBuffer.length} bytes alla stampante "${this.printerName}")`);
      try { fs.unlinkSync(tmpFile); } catch {}
      if (callback) callback(null);
    } catch (err: any) {
      console.error('[Default Printer] Errore invio alla stampante di sistema:', err.message);
      try { fs.unlinkSync(tmpFile); } catch {}
      if (callback) callback(err);
    }
    return this;
  }
}

// ─── Helper: apri una stampante (con Auto-Detect e Fallback automatico) ────────
function openPrinterDevice(pc?: PrinterConfig): { device: any; isNetwork: boolean } {
  // 1. Se specificata stampante di rete TCP
  if (pc && pc.type === 'NETWORK' && pc.networkHost) {
    const adapter = new NetworkPrinterAdapter(pc.networkHost, pc.networkPort || 9100);
    return { device: adapter, isNetwork: true };
  }

  // 2. Se specificati Vendor ID e Product ID manuali
  if (pc && pc.usbVendorId && pc.usbProductId) {
    try {
      const adapter = new CustomUSBAdapter(pc.usbVendorId, pc.usbProductId);
      return { device: adapter, isNetwork: false };
    } catch (e: any) {
      console.warn(`[Printer] USB VID:0x${pc.usbVendorId.toString(16)} non aperto via USB diretta (${e.message}). Uso stampante predefinita.`);
    }
  }

  // 3. ZERO-CONFIG: Cerca qualsiasi stampante termica USB collegata
  const anyUsb = findAnyUSBPrinter();
  if (anyUsb) {
    try {
      console.log(`[Auto-Detect] Trovata stampante termica USB: VID:0x${anyUsb.vid.toString(16)} PID:0x${anyUsb.pid.toString(16)}`);
      const adapter = new CustomUSBAdapter(anyUsb.vid, anyUsb.pid);
      return { device: adapter, isNetwork: false };
    } catch (e: any) {
      console.log(`[Auto-Detect] Porta USB diretta occupata dal driver (${e.message}). Passo alla stampante di sistema.`);
    }
  }

  // 4. ZERO-CONFIG DEFAULT: Usa la stampante predefinita di sistema (es. Printer_POS_80)
  const defaultName = getDefaultSystemPrinter();
  console.log(`[Auto-Detect] Uso stampante di sistema predefinita di default: "${defaultName || 'Sistema'}" (80mm)`);
  const sysAdapter = new SystemDefaultPrinterAdapter(defaultName || undefined);
  return { device: sysAdapter, isNetwork: false };
}

// ─── Helper: sceglie la stampante giusta (con default zero-config) ─────────────
function getPrinterConfigForRole(role: string, remotePrinters: PrinterConfig[]): PrinterConfig {
  // 1. Cerca prima nella config locale (config.json)
  if (config.printers && config.printers.length > 0) {
    const local = config.printers.find(p => p.role === role);
    if (local) return local;
  }
  // 2. Cerca nel database
  const remote = remotePrinters?.find((p: PrinterConfig) => p.role === role);
  if (remote) return remote;

  // 3. ZERO-CONFIG DEFAULT: Ritorna la stampante termica predefinita di default (80mm)
  const defName = getDefaultSystemPrinter() || 'Stampante Termica 80mm Predefinita';
  return {
    type: 'USB',
    role: role,
    name: defName,
  };
}

// ─── Helpers stampa e formattazione colonne 80mm (48 caratteri) ───────────────
function applySize(printer: any, sizeStr: string) {
  if (sizeStr === 'GIANT') printer.size(2, 2);
  else if (sizeStr === 'DOUBLE_HEIGHT') printer.size(1, 2);
  else printer.size(1, 1);
}

function formatTwoColumns(left: string, right: string, width = 40): string {
  const r = String(right || '').trim();
  const maxLeft = Math.max(0, width - r.length - 1);
  const l = (left || '').length > maxLeft ? (left || '').substring(0, maxLeft) : (left || '');
  const spaces = Math.max(1, width - l.length - r.length);
  return l + ' '.repeat(spaces) + r;
}

/** Rasterizza e invia un'immagine PNG via comando ESC/POS GS v 0 (formato compatto ed elegante) */
function printRasterImage(printer: any, base64Data: string, maxWidth = 240) {
  if (!base64Data || typeof base64Data !== 'string') return;
  try {
    const cleanBase64 = base64Data.replace(/^data:image\/\w+;base64,/, '').trim();
    if (!cleanBase64) return;
    const rawBuffer = Buffer.from(cleanBase64, 'base64');
    const png = PNG.sync.read(rawBuffer);

    let targetWidth = png.width;
    let targetHeight = png.height;
    if (targetWidth > maxWidth) {
      const scale = maxWidth / targetWidth;
      targetWidth = maxWidth;
      targetHeight = Math.round(png.height * scale);
    }
    if (targetWidth <= 0 || targetHeight <= 0) return;

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

        if (a < 128) continue; // Trasparente = bianco
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
  } catch (err: any) {
    console.warn('[Raster Image] Impossibile stampare immagine PNG:', err?.message || err);
  }
}

const DEFAULT_SETTINGS = {
  headerName: 'CAVAGLIO SOTTO LE STELLE',
  headerSubtitle: "AREA FESTE · VIA ASILO\nCAVAGLIO D'AGOGNA (NO)",
  headerAddress: '', headerVat: '', headerPhone: '',
  headerAlign: 'ct', headerSize: 'NORMAL',
  headerLogoBase64: '', footerLogoBase64: '',
  bodyFont: 'a', showOriginalPrice: true, showChangeAndDiscount: true,
  dateFormat: 'SHORT', prepItemSize: 'DOUBLE_HEIGHT', prepNoteSize: 'NORMAL',
  prepShowMetadata: true, prepVariantFormat: 'BRACKETS',
  footerText: "GRAZIE\nPER AVER SCELTO LA NOSTRA SAGRA!\n— ★ —", footerShowCount: false,
  comandaGreeting: 'Buona Sagra! ★',
  comandaShowHeader: false,
  comandaShowPrice: true,
  printToDepartments: false,
};

function formatThreeColumns(col1: string, col2: string, col3: string, w1 = 7, w3 = 7, totalWidth = 40): string {
  const c1 = String(col1 || '').padEnd(w1).substring(0, w1);
  const c3 = String(col3 || '').padStart(w3).substring(0, w3);
  const midWidth = Math.max(0, totalWidth - w1 - w3);
  const c2 = String(col2 || '').padEnd(midWidth).substring(0, midWidth);
  return c1 + c2 + c3;
}

function printItemRow(printer: any, qty: number, name: string, price: string, width = 40) {
  const w1 = 7;
  const w3 = 7;
  const midWidth = width - w1 - w3; // 26 caratteri per la descrizione

  const c1 = String(qty).padEnd(w1).substring(0, w1);
  const c3 = price.padStart(w3).substring(0, w3);

  if (name.length <= midWidth) {
    const c2 = name.padEnd(midWidth);
    printer.text(c1 + c2 + c3);
  } else {
    // Prima riga con qtà, inizio descrizione e prezzo allineato a destra
    const firstPart = name.substring(0, midWidth);
    printer.text(c1 + firstPart + c3);
    // Righe successive rientrate perfettamente sotto la colonna descrizione
    let remaining = name.substring(midWidth);
    while (remaining.length > 0) {
      const chunk = remaining.substring(0, midWidth);
      printer.text(' '.repeat(w1) + chunk);
      remaining = remaining.substring(midWidth);
    }
  }
}

// ─── Stampa scontrino cliente compatto ed elegante (Salva-Carta 40 colonne) ────
function printScontrino(printer: any, payload: any, settings: any) {
  const lineDivider = '----------------------------------------'; // 40 caratteri esatti

  // 1. Logo compatto in testata (se configurato) o Nome Evento
  if (settings.headerLogoBase64) {
    printRasterImage(printer, settings.headerLogoBase64, 240);
  } else if (settings.headerName) {
    printer.align('ct').style('b').text(settings.headerName).style('normal');
  }

  // Sottotitolo compatto (fino a 2 righe, es. Area Feste / Via Asilo)
  const rawSubtitle = settings.headerSubtitle || settings.headerAddress || '';
  if (rawSubtitle) {
    printer.align('ct').style('normal');
    rawSubtitle.split('\n').map((l: string) => l.trim()).filter(Boolean).slice(0, 2).forEach((line: string) => {
      printer.text(line);
    });
  }

  printer.text(lineDivider);

  // 2. Riga metadati elegante (Data, Ora, #Scontrino e Tavolo come da foto)
  const orderDate = new Date(payload.createdAt || Date.now());
  const dateStr = orderDate.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const timeStr = orderDate.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  const orderNumStr = String(payload.orderNumber || 0).padStart(4, '0');

  let tableOrCustomer = 'ASPORTO';
  if (payload.customerName && payload.customerName !== 'Asporto / Generico') {
    const isTavolo = /^tavolo\s*\d+/i.test(payload.customerName.trim());
    tableOrCustomer = isTavolo ? payload.customerName.toUpperCase() : `TAV. ${payload.customerName.toUpperCase()}`;
  }

  printer.align('lt').font('a');
  printer.text(formatTwoColumns(`DATA   ${dateStr}`, `ORA  ${timeStr}`, 40));
  printer.text(formatTwoColumns(tableOrCustomer, `N. SCONTRINO ${orderNumStr}`, 40));
  printer.text(lineDivider);

  // 3. Intestazione colonne articoli (esattamente come da foto)
  printer.text(formatThreeColumns('Q.TÀ', 'DESCRIZIONE', 'PREZZO', 7, 7, 40));

  // 4. Righe articoli (allineamento perfetto a 3 colonne)
  payload.items.forEach((item: any) => {
    const isOmaggio = (item.priceAtTime === 0 && (!payload.discount || payload.discount === 0)) ||
      (item.note && item.note.includes('OMAGGIO')) ||
      (item.variantName && item.variantName.includes('OMAGGIO'));

    const priceNum = isOmaggio ? 0 : item.priceAtTime * item.quantity;
    const priceFormatted = priceNum.toFixed(2).replace('.', ',');

    let itemDesc = item.product?.name || 'Articolo';
    if (isOmaggio) itemDesc += ' (OMAGGIO)';
    if (item.variantName && !item.variantName.includes('OMAGGIO')) {
      itemDesc += ` [${item.variantName}]`;
    }

    printItemRow(printer, item.quantity, itemDesc, priceFormatted, 40);

    // Note essenziali
    const cleanNote = (item.note || '').replace(/\[OMAGGIO\]/g, '').trim();
    if (cleanNote) {
      printer.text(`       * ${cleanNote}`);
    }

    if (item.product?.isCombo && item.product?.comboItems) {
      item.product.comboItems.forEach((cItem: any) => {
        printer.text(`       - ${cItem.quantity * item.quantity}x ${cItem.component?.name || 'Componente'}`);
      });
    }
  });

  printer.text(lineDivider);

  // 5. Sconto (se presente) e Totale
  if (payload.discount && Number(payload.discount) > 0) {
    const scontoFormatted = `-${Number(payload.discount).toFixed(2).replace('.', ',')}`;
    printer.text(formatTwoColumns('SCONTO', scontoFormatted, 40));
  }

  const totFormatted = Number(payload.totalAmount || 0).toFixed(2).replace('.', ',');
  printer.style('b');
  printer.text(formatTwoColumns('TOTALE', totFormatted, 40));
  printer.style('normal');

  // Metodo di pagamento
  const paymentMethod = payload.paymentType === 'CARD' ? 'CARTA' : 'CONTANTI';
  printer.text(' ');
  printer.text(`PAGAMENTO  ${paymentMethod}`);

  // 6. Ringraziamento & Grafica Piè di Pagina (come da foto)
  printer.text(' ').align('ct');
  if (settings.footerText) {
    settings.footerText.split('\n').map((l: string) => l.trim()).filter(Boolean).forEach((line: string) => {
      printer.text(line);
    });
  } else {
    printer.text('GRAZIE');
    printer.text('PER AVER SCELTO LA NOSTRA SAGRA!');
    printer.text('— ★ —');
  }

  if (settings.footerLogoBase64) {
    printRasterImage(printer, settings.footerLogoBase64, 240);
  }

  // 7. Taglio rapido senza spreco di carta
  printer.text(' ').cut();
}

// ─── Stampa talloncini comanda compatti per i reparti (Salva-Carta 40 colonne) ─
function printComande(printer: any, payload: any, settings: any, categoryFilter?: string) {
  const prepList: any[] = [];

  payload.items.forEach((item: any) => {
    const catName = item.product?.category?.name || 'Generico';

    if (item.product?.isCombo && item.product?.comboItems) {
      item.product.comboItems.forEach((cItem: any) => {
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
    } else {
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

  if (filtered.length === 0) return;

  const lineDivider = '----------------------------------------'; // 40 caratteri
  const orderNumStr = String(payload.orderNumber || 0).padStart(4, '0');
  const timeStr = new Date(payload.createdAt || Date.now()).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });

  let tableOrCustomer = 'ASPORTO';
  if (payload.customerName && payload.customerName !== 'Asporto / Generico') {
    const isTavolo = /^tavolo\s*\d+/i.test(payload.customerName.trim());
    tableOrCustomer = isTavolo ? payload.customerName.toUpperCase() : `TAV. ${payload.customerName.toUpperCase()}`;
  }

  filtered.forEach((prep: any) => {
    printer.align('lt').font('a');

    // 1. Intestazione facoltativa talloncino (attivabile in impostazioni)
    if (settings.comandaShowHeader) {
      if (settings.headerLogoBase64) {
        printRasterImage(printer, settings.headerLogoBase64, 200);
      } else if (settings.headerName) {
        printer.align('ct').style('b').text(settings.headerName).style('normal');
      }
      const rawSubtitle = settings.headerSubtitle || settings.headerAddress || '';
      if (rawSubtitle) {
        printer.align('ct').style('normal');
        rawSubtitle.split('\n').map((l: string) => l.trim()).filter(Boolean).slice(0, 2).forEach((line: string) => {
          printer.text(line);
        });
      }
      printer.text(lineDivider);
    } else {
      printer.text(lineDivider);
    }

    // 2. Articolo in risalto (grande e in grassetto come nella foto)
    const isOmaggio = (prep.priceAtTime === 0 && (!payload.discount || payload.discount === 0)) ||
      (prep.note && prep.note.includes('OMAGGIO')) ||
      (prep.variantName && prep.variantName.includes('OMAGGIO'));

    let rightCol = '';
    if (isOmaggio) {
      rightCol = 'OMAGGIO';
    } else if (settings.comandaShowPrice !== false && typeof prep.priceAtTime === 'number' && prep.priceAtTime > 0) {
      rightCol = prep.priceAtTime.toFixed(2).replace('.', ',');
    }

    printer.align('lt');
    if (settings.prepItemSize === 'GIANT') {
      printer.size(2, 2).style('b');
    } else if (settings.prepItemSize === 'NORMAL') {
      printer.size(1, 1).style('b');
    } else {
      printer.size(1, 2).style('b'); // Default DOUBLE_HEIGHT: mantiene 40 colonne
    }

    const itemTitle = prep.name.toUpperCase();
    if (rightCol) {
      printer.text(formatTwoColumns(itemTitle, rightCol, 40));
    } else {
      printer.text(itemTitle);
    }
    printer.size(1, 1).style('normal');

    // Varianti o note
    const cleanVariant = prep.variantName && !prep.variantName.includes('OMAGGIO') ? prep.variantName : '';
    const cleanNote = (prep.note || '').replace(/\[OMAGGIO\]/g, '').trim();
    if (cleanVariant || cleanNote) {
      const detail = [cleanVariant, cleanNote].filter(Boolean).join(' - ');
      printer.text(`   * ${detail}`);
    }
    if (prep.comboName) {
      printer.text(`   [Menu: ${prep.comboName}]`);
    }

    // 3. Metadati Ordine minimi (per riconoscimento al bancone o cucina)
    printer.text(lineDivider);
    printer.text(formatTwoColumns(`ORD. #${orderNumStr}  ${timeStr}`, tableOrCustomer, 40));
    printer.text(lineDivider);

    // 4. Augurio finale (es. Buona Sagra! ★)
    const greeting = settings.comandaGreeting || 'Buona Sagra! ★';
    if (greeting) {
      printer.align('ct').style('b');
      greeting.split('\n').map((l: string) => l.trim()).filter(Boolean).forEach((line: string) => {
        printer.text(line);
      });
      printer.style('normal');
    }

    // 5. Taglio rapido senza spreco di carta
    printer.text(' ').cut();
  });
}

// ─── Esegui stampa su un adapter ──────────────────────────────────────────────
function printOnAdapter(
  printerConfig: PrinterConfig,
  renderFn: (printer: any) => void,
  onDone: (err?: any) => void,
) {
  let device: any;
  try {
    const { device: d } = openPrinterDevice(printerConfig);
    device = d;
  } catch (e: any) {
    console.error(`[Printer] Impossibile aprire ${printerConfig.name || printerConfig.type}:`, e.message);
    return onDone(e);
  }

  device.open((openErr: any) => {
    if (openErr) {
      console.error(`[Printer] Errore apertura ${printerConfig.name}:`, openErr.message || openErr);
      return onDone(openErr);
    }

    const printer = new escpos.Printer(device);
    console.log(`[Printer] ✅ Stampa su "${printerConfig.name}" (${printerConfig.type === 'NETWORK' ? printerConfig.networkHost : `USB VID:${printerConfig.usbVendorId?.toString(16)}`})`);

    try {
      renderFn(printer);
    } catch (e: any) {
      console.error('[Printer] Errore rendering stampa:', e.message);
    }

    printer.close(() => {
      console.log(`[Printer] ✅ Job completato su "${printerConfig.name}"`);
      onDone(null);
    });
  });
}

// ─── Invia ACK al server ───────────────────────────────────────────────────────
async function sendAck(jobId: string, status: 'PRINTED' | 'ERROR', errorMsg?: string) {
  try {
    await fetch(`${config.SERVER_URL}/api/print-jobs/${jobId}/ack`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, errorMsg }),
    });
  } catch (e: any) {
    console.warn(`[ACK] Impossibile inviare ACK per job ${jobId}:`, e.message);
  }
}

// ─── Recupera job pending al riavvio ──────────────────────────────────────────
async function fetchPendingJobs(): Promise<any[]> {
  try {
    const url = config.STATION_ID
      ? `${config.SERVER_URL}/api/print-jobs/pending?stationId=${config.STATION_ID}`
      : `${config.SERVER_URL}/api/print-jobs/pending`;
    const res = await fetch(url);
    if (res.ok) return res.json();
  } catch (e) {}
  return [];
}

// ─── Socket.IO ────────────────────────────────────────────────────────────────
const socket = io(config.SERVER_URL, {
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
  console.log(`[Socket] Connesso al server. ID: ${socket.id}`);

  // Registra il print-agent con la propria stationId
  socket.emit('print-agent-register', {
    stationId: config.STATION_ID,
    agentId: config.AGENT_ID,
  });

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

// ─── Processing del job ───────────────────────────────────────────────────────
async function processJob(job: any) {
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

  let payload: any;
  try {
    payload = JSON.parse(job.payload);
  } catch (e) {
    console.error('[Job] Payload JSON non valido:', e);
    await sendAck(job.id, 'ERROR', 'Payload JSON non valido');
    return;
  }

  const settings = { ...DEFAULT_SETTINGS, ...(payload.settings || {}) };

  // Stampanti disponibili: prima quelle del payload (dal DB), poi quelle locali in config
  const remotePrinters: PrinterConfig[] = payload.printerConfigs || [];

  try {
    if (payload.type === 'REPORT_X' || payload.type === 'REPORT_Z') {
      // Stampa su stampante CASHIER
      const printerConfig = getPrinterConfigForRole('CASHIER', remotePrinters);
      if (!printerConfig) {
        console.warn('[Job] Nessuna stampante CASHIER configurata per il report.');
        await sendAck(job.id, 'ERROR', 'Nessuna stampante CASHIER configurata');
        return;
      }

      await new Promise<void>((resolve) => {
        printOnAdapter(printerConfig, (printer) => {
          const report = payload.reportData || {};
          printer.font('a').align('ct').style('b').size(1, 2).text(
            payload.type === 'REPORT_Z' ? 'CHIUSURA DI CASSA Z' : 'LETTURA X (RESOCONTO)'
          );
          printer.size(1, 1).style('normal').text('----------------------------------------').align('lt');
          printer.text(formatTwoColumns(`Data: ${new Date().toLocaleDateString('it-IT')}`, `Ora: ${new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}`, 40));
          if (report.openedAt) {
            printer.text(`Apertura: ${new Date(report.openedAt).toLocaleString('it-IT')}`);
          }
          printer.text(`Ordini totali: ${report.orderCount || 0}`);
          printer.text('----------------------------------------');
          printer.style('b').text(formatTwoColumns('INCASSO LORDO', `EUR ${(report.totalGross || 0).toFixed(2)}`, 40)).style('normal');
          if (report.totalDiscount && Number(report.totalDiscount) > 0) {
            printer.text(formatTwoColumns('SCONTI TOTALI', `EUR -${Number(report.totalDiscount).toFixed(2)}`, 40));
          }
          if (report.paymentBreakdown) {
            printer.text(formatTwoColumns('  Di cui Contanti:', `EUR ${(report.paymentBreakdown.CASH || 0).toFixed(2)}`, 40));
            printer.text(formatTwoColumns('  Di cui Carta/POS:', `EUR ${(report.paymentBreakdown.CARD || 0).toFixed(2)}`, 40));
          }
          printer.text('----------------------------------------');
          printer.style('b').size(1, 2).text(formatTwoColumns('INCASSO NETTO', `EUR ${(report.totalNet || 0).toFixed(2)}`, 40)).size(1, 1).style('normal');
          printer.text('----------------------------------------');
          if (report.categoryBreakdown && Object.keys(report.categoryBreakdown).length > 0) {
            printer.align('ct').style('b').text('VENDITE PER REPARTO').style('normal').align('lt');
            Object.entries(report.categoryBreakdown).forEach(([cat, amount]: [string, any]) => {
              printer.text(formatTwoColumns(cat, `EUR ${Number(amount).toFixed(2)}`, 40));
            });
            printer.text('----------------------------------------');
          }
          if (report.productStats && Object.keys(report.productStats).length > 0) {
            printer.align('ct').style('b').text('ARTICOLI VENDUTI').style('normal').align('lt');
            Object.entries(report.productStats).forEach(([prod, stat]: [string, any]) => {
              printer.text(formatTwoColumns(`${stat.qty}x ${prod}`, `EUR ${Number(stat.total).toFixed(2)}`, 40));
            });
            printer.text('----------------------------------------');
          }
          if (payload.type === 'REPORT_Z') {
            printer.align('ct').style('b').text('*** FINE CHIUSURA Z ***').style('normal').text(' ').cut();
          } else {
            printer.align('ct').style('b').text('*** FINE LETTURA X ***').style('normal').text(' ').cut();
          }
        }, resolve);
      });

      await sendAck(job.id, 'PRINTED');

    } else if (payload.type === 'STORNO') {
      const order = payload.order;
      const printerConfig = getPrinterConfigForRole('CASHIER', remotePrinters);
      if (!printerConfig) {
        console.warn('[Job] Nessuna stampante CASHIER per storno.');
        await sendAck(job.id, 'ERROR', 'Nessuna stampante CASHIER');
        return;
      }

      await new Promise<void>((resolve) => {
        printOnAdapter(printerConfig, (printer) => {
          printer.font('a').align('ct').style('b').size(1, 2).text('STORNO ORDINE');
          printer.size(1, 1).style('normal').text('----------------------------------------').align('lt');
          printer.text(`ORDINE ORIGINALE: #${order.orderNumber}`);
          printer.text(`STORNATO IL: ${new Date().toLocaleString('it-IT')}`);
          printer.text('----------------------------------------');
          order.items.forEach((item: any) => {
            const varName = item.variantName
              ? settings.prepVariantFormat === 'BRACKETS' ? ` [${item.variantName}]` : ` * ${item.variantName}`
              : '';
            const line = `-${item.quantity}x ${item.product.name}${varName}`;
            const total = (item.priceAtTime * item.quantity * -1).toFixed(2);
            printer.text(formatTwoColumns(line, total, 40));
          });
          printer.text('----------------------------------------').align('ct').style('b');
          printer.text(formatTwoColumns('TOTALE STORNO: EUR', `-${order.totalAmount.toFixed(2)}`, 40));
          printer.style('normal').text(' ').cut();
        }, resolve);
      });

      await sendAck(job.id, 'PRINTED');

    } else {
      // Ordine normale: scontrino + comande
      const isCashierJob = job.printerId === 'CASHIER' || !job.printerId;
      const isKitchenJob = job.printerId !== 'CASHIER';

      if (isCashierJob) {
        // ── ALLA CASSA: Stampa biglietto riepilogativo + biglietto per ciascun articolo ──
        const printerConfig = getPrinterConfigForRole('CASHIER', remotePrinters);
        await new Promise<void>((resolve) => {
          printOnAdapter(printerConfig, (printer) => {
            // 1. Biglietto riepilogativo per il cliente (totale, sconti, articoli, pagamento)
            printScontrino(printer, payload, settings);
            // 2. Biglietto per ciascun articolo ordinato
            printComande(printer, payload, settings);
          }, resolve);
        });
      } else if (isKitchenJob) {
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
          await new Promise<void>((resolve) => {
            printOnAdapter(pc, (printer) => printComande(printer, payload, settings, filter || undefined), resolve);
          });
        }
      }

      await sendAck(job.id, 'PRINTED');
    }
  } catch (e: any) {
    console.error(`[Job] Errore processing:`, e.message || e);
    await sendAck(job.id, 'ERROR', e?.message || 'Errore sconosciuto');
  }
}

// ─── Listener print-job ───────────────────────────────────────────────────────
socket.on('print-job', async (job: any) => {
  await processJob(job);
});
