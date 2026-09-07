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
  headerName: 'BAR NUVOLA S.R.L.',
  headerSubtitle: 'Via Roma, 15 - Milano',
  headerAddress: '',
  headerVat: '12345678901',
  headerPhone: '02 1234567',
  headerAlign: 'ct',
  headerSize: 'NORMAL',
  headerLogoBase64: '',
  footerLogoBase64: '',
  bodyFont: 'a',
  showOriginalPrice: true,
  showChangeAndDiscount: true,
  dateFormat: 'SHORT',
  prepItemSize: 'NORMAL',
  prepNoteSize: 'NORMAL',
  prepShowMetadata: true,
  prepVariantFormat: 'BRACKETS',
  footerText: 'GRAZIE E ARRIVEDERCI!',
  comandaGreeting: 'GRAZIE E BUONA SAGRA!',
  comandaShowHeader: false,
  comandaShowPrice: true,
  printToDepartments: false,
};

const LINE_EQ_32 = '================================';
const LINE_DASH_32 = '--------------------------------';

/** Pulisce e sanitizza qualsiasi stringa per eliminare caratteri Unicode corrotti su stampanti termiche */
function cleanReceiptText(str: string): string {
  if (!str) return '';
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

/** Centra una riga su esattamente 32 caratteri */
function centerLine(text: string, width = 32): string {
  const clean = cleanReceiptText(text);
  if (!clean) return '';
  if (clean.length >= width) return clean.substring(0, width);
  const pad = Math.floor((width - clean.length) / 2);
  return ' '.repeat(pad) + clean + ' '.repeat(width - clean.length - pad);
}

/** Allinea due colonne su esattamente 32 caratteri */
function alignTwoColumns(left: string, right: string, width = 32): string {
  const l = cleanReceiptText(left);
  const r = cleanReceiptText(right);
  const maxLeft = Math.max(0, width - r.length - 1);
  const truncatedLeft = l.length > maxLeft ? l.substring(0, maxLeft) : l;
  const spaces = Math.max(1, width - truncatedLeft.length - r.length);
  return truncatedLeft + ' '.repeat(spaces) + r;
}

// ─── Stampa scontrino cliente a 32 colonne (Documento Commerciale) ─────────────
function printScontrino(printer: any, payload: any, settings: any) {
  printer.font('a').size(1, 1).style('normal').align('lt');

  // 1. Intestazione Azienda / Evento (centrata, 32 caratteri)
  printer.text(LINE_EQ_32);
  if (settings.headerLogoBase64) {
    printRasterImage(printer, settings.headerLogoBase64, 240);
  }
  const name = settings.headerName || 'BAR NUVOLA S.R.L.';
  printer.text(centerLine(name, 32));

  const addr = settings.headerSubtitle || settings.headerAddress || '';
  if (addr) {
    addr.split('\n').map((l: string) => l.trim()).filter(Boolean).forEach((line: string) => {
      printer.text(centerLine(line, 32));
    });
  }
  if (settings.headerVat) {
    printer.text(centerLine(`P.IVA / C.F.: ${settings.headerVat}`, 32));
  }
  if (settings.headerPhone) {
    printer.text(centerLine(`Tel: ${settings.headerPhone}`, 32));
  }
  printer.text(LINE_EQ_32);

  // 2. Dicitura Documento Commerciale
  printer.text(centerLine('DOCUMENTO COMMERCIALE', 32));
  printer.text(centerLine('di vendita o prestazione', 32));
  printer.text(' ');

  // 3. Intestazione tabella articoli (24 car descrizione + 8 car prezzo = 32 car)
  printer.text('DESCRIZIONE             PREZZO  ');
  printer.text(LINE_DASH_32);

  // 4. Righe Articoli
  let subtotalCalc = 0;
  payload.items.forEach((item: any) => {
    const isOmaggio = (item.priceAtTime === 0 && (!payload.discount || payload.discount === 0)) ||
      (item.note && item.note.includes('OMAGGIO')) ||
      (item.variantName && item.variantName.includes('OMAGGIO'));

    const priceNum = isOmaggio ? 0 : item.priceAtTime * item.quantity;
    subtotalCalc += priceNum;
    const priceFormatted = priceNum.toFixed(2).replace('.', ',');

    let itemDesc = `${item.quantity} ${cleanReceiptText(item.product?.name || 'Articolo').toUpperCase()}`;
    if (item.quantity > 1 && item.priceAtTime > 0) {
      const unitStr = `(E ${item.priceAtTime.toFixed(2).replace('.', ',')})`;
      if (itemDesc.length + unitStr.length + 1 <= 24) {
        itemDesc += ` ${unitStr}`;
      }
    }
    if (isOmaggio) itemDesc += ' (OMAGGIO)';

    const priceCol = priceFormatted.padStart(6) + '  '; // 8 caratteri

    if (itemDesc.length <= 24) {
      printer.text(itemDesc.padEnd(24) + priceCol);
    } else {
      printer.text(itemDesc.substring(0, 24) + priceCol);
      let rem = itemDesc.substring(24).trim();
      while (rem.length > 0) {
        printer.text('  ' + rem.substring(0, 30));
        rem = rem.substring(30).trim();
      }
    }

    // Varianti o note articolo
    const cleanVariant = item.variantName && !item.variantName.includes('OMAGGIO') ? cleanReceiptText(item.variantName) : '';
    const cleanNote = cleanReceiptText((item.note || '').replace(/\[OMAGGIO\]/g, ''));
    if (cleanVariant || cleanNote) {
      const detail = [cleanVariant, cleanNote].filter(Boolean).join(' - ');
      printer.text(`  * ${detail}`);
    }

    // Combo items
    if (item.product?.isCombo && item.product?.comboItems) {
      item.product.comboItems.forEach((cItem: any) => {
        printer.text(`  - ${cItem.quantity * item.quantity}x ${cleanReceiptText(cItem.component?.name || 'Componente')}`);
      });
    }
  });

  printer.text(LINE_DASH_32);

  // 5. Subtotale e Sconto
  const subFormatted = subtotalCalc.toFixed(2).replace('.', ',');
  printer.text(alignTwoColumns('SUBTOTALE', `E ${subFormatted} `, 32));

  if (payload.discount && Number(payload.discount) > 0) {
    const scontoFormatted = Number(payload.discount).toFixed(2).replace('.', ',');
    printer.text(alignTwoColumns('SCONTO', `-E ${scontoFormatted} `, 32));
  } else {
    printer.text(alignTwoColumns('SCONTO', 'E 0,00 ', 32));
  }

  printer.text(' ');
  printer.text(LINE_DASH_32);

  // 6. Totale (grassetto, 32 colonne)
  const totFormatted = Number(payload.totalAmount || 0).toFixed(2).replace('.', ',');
  printer.style('b');
  printer.text(alignTwoColumns('TOTALE', `E ${totFormatted} `, 32));
  printer.style('normal');
  printer.text(LINE_DASH_32);

  // 7. Pagamento
  printer.text('PAGAMENTO                       ');
  const paymentMethod = payload.paymentType === 'CARD' ? 'ELETTRONICO (POS)' : 'CONTANTI';
  printer.text(alignTwoColumns(paymentMethod, `E ${totFormatted} `, 32));
  printer.text(alignTwoColumns('RESTO', 'E 0,00 ', 32));

  printer.text(LINE_DASH_32);

  // 8. Metadati Fiscali / Ordine
  const orderDate = new Date(payload.createdAt || Date.now());
  const dateStr = orderDate.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const timeStr = orderDate.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  const orderNumStr = String(payload.orderNumber || 0).padStart(4, '0');

  printer.text(alignTwoColumns('N. DOC.:', `${orderNumStr}-0001`, 32));
  printer.text(alignTwoColumns('DATA:', dateStr, 32));
  printer.text(alignTwoColumns('ORA:', timeStr, 32));

  let tableOrCustomer = 'ASPORTO';
  if (payload.customerName && payload.customerName !== 'Asporto / Generico') {
    tableOrCustomer = payload.customerName.toUpperCase().replace(/^TAVOLO\s*/i, 'TAV. ');
  }
  const stationLabel = payload.stationId ? `CASSA: ${payload.stationId.substring(0, 2).toUpperCase()}` : 'CASSA: 01';
  printer.text(alignTwoColumns(stationLabel, tableOrCustomer, 32));

  printer.text(LINE_DASH_32);

  // 9. Chiusura e Ringraziamento
  printer.text(LINE_EQ_32);
  const footerText = settings.footerText || 'GRAZIE E ARRIVEDERCI!';
  footerText.split('\n').map((l: string) => l.trim()).filter(Boolean).forEach((line: string) => {
    printer.text(centerLine(line, 32));
  });
  printer.text(LINE_EQ_32);

  if (settings.footerLogoBase64) {
    printRasterImage(printer, settings.footerLogoBase64, 240);
  }

  // 10. Taglio immediato (nessun foglio sprecato)
  printer.text(' ').cut();
}

// ─── Stampa talloncini comanda compatti a 32 colonne (Salva-Carta) ─────────────
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

  const orderNumStr = String(payload.orderNumber || 0).padStart(4, '0');
  const timeStr = new Date(payload.createdAt || Date.now()).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });

  let tableOrCustomer = 'ASPORTO';
  if (payload.customerName && payload.customerName !== 'Asporto / Generico') {
    tableOrCustomer = payload.customerName.toUpperCase().replace(/^TAVOLO\s*/i, 'TAV. ');
  }

  filtered.forEach((prep: any) => {
    printer.font('a').size(1, 1).style('normal').align('lt');

    // 1. Intestazione facoltativa (solo se abilitata nelle impostazioni)
    if (settings.comandaShowHeader) {
      printer.text(LINE_EQ_32);
      if (settings.headerLogoBase64) {
        printRasterImage(printer, settings.headerLogoBase64, 200);
      }
      printer.text(centerLine(settings.headerName || 'BAR NUVOLA S.R.L.', 32));
      printer.text(LINE_EQ_32);
    } else {
      printer.text(LINE_EQ_32);
    }

    // 2. Numero Ordine, Ora e Tavolo ben chiari
    printer.text(alignTwoColumns(`ORD. #${orderNumStr} ${timeStr}`, tableOrCustomer, 32));
    printer.text(LINE_DASH_32);

    // 3. Articolo in risalto (font standard ben visibile con eventuale prezzo a lato)
    const isOmaggio = (prep.priceAtTime === 0 && (!payload.discount || payload.discount === 0)) ||
      (prep.note && prep.note.includes('OMAGGIO')) ||
      (prep.variantName && prep.variantName.includes('OMAGGIO'));

    let rightCol = '';
    if (isOmaggio) {
      rightCol = 'OMAGGIO';
    } else if (settings.comandaShowPrice !== false && typeof prep.priceAtTime === 'number' && prep.priceAtTime > 0) {
      rightCol = `E ${prep.priceAtTime.toFixed(2).replace('.', ',')}`;
    }

    printer.style('b');
    const itemTitle = `1x ${cleanReceiptText(prep.name).toUpperCase()}`;
    if (rightCol) {
      printer.text(alignTwoColumns(itemTitle, rightCol, 32));
    } else {
      printer.text(itemTitle);
    }
    printer.style('normal');

    // Varianti o note
    const cleanVariant = prep.variantName && !prep.variantName.includes('OMAGGIO') ? cleanReceiptText(prep.variantName) : '';
    const cleanNote = cleanReceiptText((prep.note || '').replace(/\[OMAGGIO\]/g, ''));
    if (cleanVariant || cleanNote) {
      const detail = [cleanVariant, cleanNote].filter(Boolean).join(' - ');
      printer.text(`   * ${detail}`);
    }
    if (prep.comboName) {
      printer.text(`   [Menu: ${cleanReceiptText(prep.comboName)}]`);
    }

    // 4. Augurio finale e chiusura
    printer.text(LINE_DASH_32);
    const greeting = settings.comandaGreeting || 'GRAZIE E BUONA SAGRA!';
    greeting.split('\n').map((l: string) => l.trim()).filter(Boolean).forEach((line: string) => {
      printer.text(centerLine(line, 32));
    });
    printer.text(LINE_EQ_32);

    // 5. Taglio rapido
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

    const printer = new escpos.Printer(device, { encoding: 'CP858' });
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
    console.warn(`[Ack] Invio fallito: ${e.message}`);
  }
}

// ─── Polling di recovery per job non stampati quando l'agent era offline ───────
async function fetchPendingJobs(): Promise<any[]> {
  try {
    const res = await fetch(`${config.SERVER_URL}/api/print-jobs/pending?stationId=${config.STATION_ID || ''}`);
    if (!res.ok) return [];
    return (await res.json()) as any[];
  } catch {
    return [];
  }
}

// ─── Connessione WebSocket e registrazione ─────────────────────────────────────
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
  console.log(`[Socket] Connesso al server: ${config.SERVER_URL}`);

  // Invia handshake di registrazione con ID della stazione
  socket.emit('register-print-agent', {
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
          printer.font('a').size(1, 1).style('normal').align('lt');
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
            Object.entries(report.categoryBreakdown).forEach(([cat, amount]: [string, any]) => {
              printer.text(alignTwoColumns(cleanReceiptText(cat), `E ${Number(amount).toFixed(2)}`, 32));
            });
            printer.text(LINE_DASH_32);
          }
          if (report.productStats && Object.keys(report.productStats).length > 0) {
            printer.text(centerLine('ARTICOLI VENDUTI', 32));
            Object.entries(report.productStats).forEach(([prod, stat]: [string, any]) => {
              printer.text(alignTwoColumns(`${stat.qty}x ${cleanReceiptText(prod)}`, `E ${Number(stat.total).toFixed(2)}`, 32));
            });
            printer.text(LINE_DASH_32);
          }
          printer.text(LINE_EQ_32);
          const endMsg = payload.type === 'REPORT_Z' ? '*** FINE CHIUSURA Z ***' : '*** FINE LETTURA X ***';
          printer.text(centerLine(endMsg, 32));
          printer.text(LINE_EQ_32);
          printer.text(' ').cut();
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
          printer.font('a').size(1, 1).style('normal').align('lt');
          printer.text(LINE_EQ_32);
          printer.text(centerLine('STORNO ORDINE', 32));
          printer.text(LINE_EQ_32);
          printer.text(alignTwoColumns('ORD. ORIGINALE:', `#${order.orderNumber}`, 32));
          printer.text(alignTwoColumns('DATA STORNATO:', new Date().toLocaleDateString('it-IT'), 32));
          printer.text(LINE_DASH_32);
          order.items.forEach((item: any) => {
            const varName = item.variantName ? ` [${cleanReceiptText(item.variantName)}]` : '';
            const line = `-${item.quantity}x ${cleanReceiptText(item.product.name)}${varName}`;
            const total = `-${(item.priceAtTime * item.quantity).toFixed(2)}`;
            printer.text(alignTwoColumns(line, total, 32));
          });
          printer.text(LINE_DASH_32);
          printer.style('b').text(alignTwoColumns('TOTALE STORNO:', `-E ${order.totalAmount.toFixed(2)}`, 32)).style('normal');
          printer.text(LINE_EQ_32);
          printer.text(' ').cut();
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
