import { io } from 'socket.io-client';
import fs from 'fs';
import path from 'path';
import * as dotenv from 'dotenv';
import net from 'net';
import http from 'http';
// @ts-ignore
import escpos from 'escpos';
import { getDeviceList } from 'usb';


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

// ─── Helper: apri una stampante dalla config ───────────────────────────────────
function openPrinterDevice(pc: PrinterConfig): { device: any; isNetwork: boolean } {
  if (pc.type === 'NETWORK') {
    if (!pc.networkHost) throw new Error('networkHost non configurato');
    const adapter = new NetworkPrinterAdapter(pc.networkHost, pc.networkPort || 9100);
    return { device: adapter, isNetwork: true };
  } else {
    const vid = pc.usbVendorId;
    const pid = pc.usbProductId;
    if (!vid || !pid) throw new Error('usbVendorId/usbProductId non configurati');
    const adapter = new CustomUSBAdapter(vid, pid);
    return { device: adapter, isNetwork: false };
  }
}

// ─── Helper: sceglie la stampante giusta per il ruolo del job ─────────────────
function getPrinterConfigForRole(role: string, remotePrinters: PrinterConfig[]): PrinterConfig | undefined {
  // Prima: cerca nelle stampanti locali (config.json)
  if (config.printers && config.printers.length > 0) {
    const local = config.printers.find(p => p.role === role);
    if (local) return local;
  }
  // Poi: usa quelle dal DB (passate nel payload)
  return remotePrinters?.find((p: PrinterConfig) => p.role === role);
}

// ─── Helpers stampa ───────────────────────────────────────────────────────────
function applySize(printer: any, sizeStr: string) {
  if (sizeStr === 'GIANT') printer.size(2, 2);
  else if (sizeStr === 'DOUBLE_HEIGHT') printer.size(1, 2);
  else printer.size(1, 1);
}

const DEFAULT_SETTINGS = {
  headerName: 'SAGRA DEL BORGO',
  headerAddress: '', headerVat: '', headerPhone: '',
  headerAlign: 'ct', headerSize: 'NORMAL',
  bodyFont: 'a', showOriginalPrice: true, showChangeAndDiscount: true,
  dateFormat: 'FULL', prepItemSize: 'DOUBLE_HEIGHT', prepNoteSize: 'NORMAL',
  prepShowMetadata: true, prepVariantFormat: 'BRACKETS',
  footerText: 'Grazie e Buon Appetito!', footerShowCount: true,
};

// ─── Stampa scontrino principale ──────────────────────────────────────────────
function printScontrino(printer: any, payload: any, settings: any) {
  printer.align(settings.headerAlign).style('b');
  applySize(printer, settings.headerSize);
  printer.text(settings.headerName || 'RICEVUTA');

  printer.size(1, 1).style('normal');
  if (settings.headerAddress) printer.text(settings.headerAddress);
  if (settings.headerVat) printer.text(`P.IVA: ${settings.headerVat}`);
  if (settings.headerPhone) printer.text(`Tel: ${settings.headerPhone}`);

  printer.text(' ').font(settings.bodyFont).align('lt').text(`ORDINE #${payload.orderNumber}`);

  const dateStr =
    settings.dateFormat === 'SHORT'
      ? new Date(payload.createdAt).toLocaleTimeString('it-IT')
      : new Date(payload.createdAt).toLocaleString('it-IT');
  printer.text(dateStr).text('--------------------------------');

  if (payload.customerName && payload.customerName !== 'Asporto / Generico') {
    printer.style('b').text(`Cliente: ${payload.customerName}`).style('normal');
  }

  let totalQty = 0;
  payload.items.forEach((item: any) => {
    totalQty += item.quantity;
    const varName = item.variantName
      ? settings.prepVariantFormat === 'BRACKETS'
        ? ` [${item.variantName}]`
        : ` * ${item.variantName}`
      : '';
    const line = `${item.quantity}x ${item.product.name}${varName}`;

    if (settings.showChangeAndDiscount) {
      const total = (item.priceAtTime * item.quantity).toFixed(2);
      printer.text(`${line.substring(0, 24).padEnd(24)} ${total}`);
    } else {
      printer.text(line);
    }

    if (item.product.isCombo && item.product.comboItems) {
      item.product.comboItems.forEach((cItem: any) => {
        printer.size(1, 1).style('normal').text(`   - ${cItem.quantity * item.quantity}x ${cItem.component?.name || 'Prodotto'}`);
      });
    }
  });

  printer.text('--------------------------------').align('ct').style('b');

  if (settings.showChangeAndDiscount && payload.discount && payload.discount > 0) {
    printer.size(1, 1).text(`Lordo: EUR ${(payload.totalAmount + payload.discount).toFixed(2)}`);
    printer.text(`Sconto: EUR -${payload.discount.toFixed(2)}`);
  }

  printer.size(1, 2).text(`TOTALE: EUR ${payload.totalAmount.toFixed(2)}`).size(1, 1).style('normal');

  if (settings.showChangeAndDiscount && payload.paymentType) {
    printer.text(`Pagamento: ${payload.paymentType === 'CASH' ? 'CONTANTI' : 'CARTA'}`);
  }

  printer.text(' ').align('ct');
  if (settings.footerText) {
    settings.footerText.split('\n').forEach((l: string) => printer.text(l));
  }
  if (settings.footerShowCount) {
    printer.text(`Articoli totali: ${totalQty}`);
  }

  printer.text(' ').text(' ').cut();
}

// ─── Stampa talloncini comanda ─────────────────────────────────────────────────
function printComande(printer: any, payload: any, settings: any, categoryFilter?: string) {
  const prepList: any[] = [];

  payload.items.forEach((item: any) => {
    const catName = item.product.category?.name || 'Generico';

    if (item.product.isCombo && item.product.comboItems) {
      item.product.comboItems.forEach((cItem: any) => {
        for (let i = 0; i < item.quantity * cItem.quantity; i++) {
          prepList.push({
            name: cItem.component?.name || 'Prodotto',
            variantName: item.variantName,
            categoryName: cItem.component?.category?.name || catName,
            comboName: item.product.name,
            note: item.note,
          });
        }
      });
    } else {
      for (let i = 0; i < item.quantity; i++) {
        prepList.push({
          name: item.product.name,
          variantName: item.variantName,
          categoryName: catName,
          comboName: null,
          note: item.note,
        });
      }
    }
  });

  // Filtra per categoria se richiesto
  const filtered = categoryFilter
    ? prepList.filter(p => p.categoryName.toLowerCase().includes(categoryFilter.toLowerCase()))
    : prepList;

  if (filtered.length === 0) return; // niente da stampare

  printer.font('a').align('ct');
  filtered.forEach((prep: any) => {
    if (settings.prepShowMetadata) {
      printer
        .size(1, 1)
        .text(`ORDINE #${payload.orderNumber} - ${new Date(payload.createdAt).toLocaleTimeString('it-IT')}`);
      if (payload.customerName && payload.customerName !== 'Asporto / Generico') {
        printer.text(payload.customerName);
      }
      printer.text('--------------------------------');
    }

    if (prep.comboName) {
      printer.size(1, 1).style('normal').text(`[ MENU: ${prep.comboName} ]`).text(' ');
    }

    printer.style('b');
    applySize(printer, settings.prepItemSize);
    printer.text(`1x ${prep.name}`);

    if (prep.variantName) {
      printer.style('normal');
      applySize(printer, settings.prepNoteSize);
      const v =
        settings.prepVariantFormat === 'BRACKETS'
          ? `[${prep.variantName}]`
          : `* ${prep.variantName}`;
      printer.text(v);
    }

    if (prep.note) {
      printer.size(1, 1).style('normal').text(`✏ ${prep.note}`);
    }

    printer
      .size(1, 1)
      .style('normal')
      .text(' ')
      .text(`[ ${prep.categoryName.toUpperCase()} ]`)
      .text(' ')
      .cut();
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
          const report = payload.reportData;
          printer.font('b').align('ct').style('b').size(1, 2).text(
            payload.type === 'REPORT_Z' ? '--- CHIUSURA DI CASSA Z ---' : '--- LETTURA X ---'
          );
          printer.size(1, 1).style('normal').text('--------------------------------').align('lt');
          printer.text(`Data/Ora: ${new Date().toLocaleString('it-IT')}`);
          printer.text(`Apertura: ${new Date(report.openedAt).toLocaleString('it-IT')}`);
          printer.text(`Ordini: ${report.orderCount}`);
          printer.text('--------------------------------');
          printer.style('b').text(`INCASSO LORDO: EUR ${report.totalGross.toFixed(2)}`).style('normal');
          printer.text(`Sconti: EUR -${(report.totalDiscount || 0).toFixed(2)}`);

          if (report.paymentBreakdown) {
            printer.text(`  Contanti: EUR ${(report.paymentBreakdown.CASH || 0).toFixed(2)}`);
            printer.text(`  Carta:    EUR ${(report.paymentBreakdown.CARD || 0).toFixed(2)}`);
          }

          printer.style('b').size(1, 2).text(`INCASSO NETTO: EUR ${report.totalNet.toFixed(2)}`).size(1, 1).style('normal');
          printer.text('--------------------------------').align('ct').style('b').text('REPARTI').style('normal').align('lt');

          Object.entries(report.categoryBreakdown).forEach(([cat, amount]: [string, any]) => {
            printer.text(`${cat.substring(0, 20).padEnd(20)} ${amount.toFixed(2)}`);
          });

          printer.text('--------------------------------').align('ct').style('b').text('ARTICOLI').style('normal').align('lt');
          Object.entries(report.productStats).forEach(([prod, stat]: [string, any]) => {
            printer.text(`${(stat.qty + 'x ' + prod).substring(0, 24).padEnd(24)} ${stat.total.toFixed(2)}`);
          });

          if (payload.type === 'REPORT_Z') {
            printer.text(' ').text(' ').align('ct').style('b').text('*** FINE CHIUSURA Z ***').style('normal').text(' ').cut();
          } else {
            printer.text('--------------------------------').align('ct').text('*** FINE LETTURA X ***').text('--------------------------------').text(' ').cut();
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
          printer.font('a').align('ct').style('b').size(2, 2).text('STORNO ORDINE');
          printer.size(1, 1).style('normal').text('--------------------------------').align('lt');
          printer.text(`ORDINE ORIGINALE: #${order.orderNumber}`);
          printer.text(`STORNATO IL: ${new Date().toLocaleString('it-IT')}`);
          printer.text('--------------------------------');
          order.items.forEach((item: any) => {
            const varName = item.variantName
              ? settings.prepVariantFormat === 'BRACKETS' ? ` [${item.variantName}]` : ` * ${item.variantName}`
              : '';
            const line = `-${item.quantity}x ${item.product.name}${varName}`;
            const total = (item.priceAtTime * item.quantity * -1).toFixed(2);
            printer.text(`${line.substring(0, 24).padEnd(24)} ${total}`);
          });
          printer.text('--------------------------------').align('ct').style('b');
          printer.text(`TOTALE STORNO: EUR -${order.totalAmount.toFixed(2)}`);
          printer.text(' ').text(' ').cut();
        }, resolve);
      });

      await sendAck(job.id, 'PRINTED');

    } else {
      // Ordine normale: scontrino + comande
      const isCashierJob = job.printerId === 'CASHIER' || !job.printerId;
      const isKitchenJob = job.printerId !== 'CASHIER';

      if (isCashierJob) {
        // Scontrino cliente sulla stampante CASHIER della nostra stazione
        const printerConfig = getPrinterConfigForRole('CASHIER', remotePrinters);
        if (printerConfig) {
          await new Promise<void>((resolve) => {
            printOnAdapter(printerConfig, (printer) => printScontrino(printer, payload, settings), resolve);
          });
        } else {
          console.warn('[Job] Nessuna stampante CASHIER configurata — scontrino non stampato.');
        }
      }

      if (isKitchenJob || !isCashierJob) {
        // Comande ai reparti: stampa su ogni stampante configurata per il reparto giusto
        const kitchenConfig = getPrinterConfigForRole('KITCHEN', remotePrinters);
        const barConfig = getPrinterConfigForRole('BAR', remotePrinters);
        const prepConfig = getPrinterConfigForRole('PREP', remotePrinters);

        // Raggruppa i prodotti per categoria e stampa sul reparto corretto
        const printers = [
          ...(kitchenConfig ? [{ config: kitchenConfig, filter: 'cucina' }] : []),
          ...(barConfig ? [{ config: barConfig, filter: 'bar' }] : []),
          ...(prepConfig ? [{ config: prepConfig, filter: '' }] : []),
        ];

        if (printers.length === 0) {
          console.warn('[Job] Nessuna stampante reparto configurata — comande non stampate.');
        } else {
          for (const { config: pc, filter } of printers) {
            await new Promise<void>((resolve) => {
              printOnAdapter(pc, (printer) => printComande(printer, payload, settings, filter || undefined), resolve);
            });
          }
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
