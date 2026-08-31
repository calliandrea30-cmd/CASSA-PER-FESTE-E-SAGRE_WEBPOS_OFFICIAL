import fastify from 'fastify';
import cors from '@fastify/cors';
import { Server } from 'socket.io';
import os from 'os';

import prisma from './lib/prisma';

import catalogRoutes from './routes/catalog';
import categoryRoutes from './routes/categories';
import userRoutes from './routes/users';
import settingsRoutes from './routes/settings';
import orderRoutes from './routes/orders';
import sessionRoutes from './routes/sessions';
import eventRoutes from './routes/events';
import realtimeRoutes from './routes/realtime';
import printJobRoutes from './routes/print-jobs';

const server = fastify({ logger: { level: process.env.LOG_LEVEL || 'info' } });

// ── CORS ──────────────────────────────────────────────────────────────────────
server.register(cors, { origin: true });

// ── Tolerate empty JSON bodies on DELETE / GET ────────────────────────────────
server.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, defaultDone) => {
  if (!body || (typeof body === 'string' && body.trim().length === 0)) {
    return defaultDone(null, {});
  }
  try {
    const json = JSON.parse(body as string);
    defaultDone(null, json);
  } catch (err: any) {
    err.statusCode = 400;
    defaultDone(err, undefined);
  }
});

// ── Health check ──────────────────────────────────────────────────────────────
server.get('/health', async () => ({ status: 'ok', ts: Date.now() }));

// ── Server Info (usato dal launcher per rilevare IP locale) ───────────────────
server.get('/api/server-info', async () => {
  const localIPs: string[] = [];
  try {
    for (const [, addrs] of Object.entries(os.networkInterfaces())) {
      for (const a of addrs ?? []) {
        if (a.family === 'IPv4' && !a.internal) localIPs.push(a.address);
      }
    }
  } catch {}
  return {
    status: 'ok',
    version: '2.0.0',
    localIPs,
    port: parseInt(process.env.PORT || '3001', 10),
    hostname: os.hostname(),
  };
});



// ── Socket.IO ─────────────────────────────────────────────────────────────────
const io = new Server({
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingTimeout: 20000,
  pingInterval: 10000,
});
server.decorate('io', io);

// ── Routes ────────────────────────────────────────────────────────────────────
server.register(catalogRoutes,  { prefix: '/api' });
server.register(categoryRoutes, { prefix: '/api' });
server.register(userRoutes,     { prefix: '/api' });
server.register(settingsRoutes, { prefix: '/api' });
server.register(orderRoutes,    { prefix: '/api' });
server.register(sessionRoutes,  { prefix: '/api' });
server.register(eventRoutes,    { prefix: '/api' });
server.register(realtimeRoutes, { prefix: '/api' });
server.register(printJobRoutes, { prefix: '/api' });

// ── Auto-seed: crea evento + stazione + utente di default se il DB è vuoto ───
async function autoSeed() {
  try {
    const eventCount = await prisma.event.count();
    if (eventCount > 0) return; // già inizializzato

    server.log.info('[AutoSeed] Nessun evento trovato. Creo configurazione di default...');

    const event = await prisma.event.create({
      data: {
        name: 'Evento Default',
        active: true,
        stations: {
          create: [{ name: 'Cassa 1', status: 'ONLINE' }],
        },
        users: {
          create: [{ username: 'admin', password: 'admin', pin: '1234', role: 'ADMIN' }],
        },
        categories: {
          create: [
            { name: 'Bar', orderIndex: 0 },
            { name: 'Cucina', orderIndex: 1 },
          ],
        },
      },
    });

    // Impostazioni di default
    await prisma.setting.upsert({
      where: { id: 'default' },
      update: {},
      create: { id: 'default' },
    });

    server.log.info(`[AutoSeed] ✅ Evento default creato: ${event.id}`);
  } catch (err) {
    server.log.error(`[AutoSeed] Errore durante auto-seed: ${String(err)}`);
  }
}

// ── Socket logic ──────────────────────────────────────────────────────────────
function setupSocketHandlers() {
  io.on('connection', (socket) => {
    server.log.info(`[Socket] Client connesso: ${socket.id}`);

    // Il client si unisce alla stanza del proprio evento per ricevere
    // solo gli aggiornamenti rilevanti.
    socket.on('join-event', (eventId: string) => {
      socket.join(`event:${eventId}`);
      server.log.info(`[Socket] ${socket.id} joined event:${eventId}`);
    });

    // Il print-agent si registra con la propria stationId
    socket.on('print-agent-register', (data: { stationId: string; agentId: string }) => {
      const room = `print-agent:${data.stationId}`;
      socket.join(room);
      socket.join('print-agents'); // stanza globale per stampe broadcast
      server.log.info(`[Socket] Print agent ${data.agentId} registrato per stazione ${data.stationId}`);
      io.to(room).emit('print-agent-ack', { ok: true, stationId: data.stationId });
    });

    socket.on('disconnect', (reason) => {
      server.log.info(`[Socket] Client disconnesso: ${socket.id} (${reason})`);
    });
  });
}

// ── Boot ─────────────────────────────────────────────────────────────────────
const start = async () => {
  try {
    const port = parseInt(process.env.PORT || '3001', 10);
    await server.listen({ port, host: '0.0.0.0' });
    server.log.info('Listen resolved!');
    io.attach(server.server);
    await autoSeed();
    setupSocketHandlers();
    server.log.info(`[Boot] API server in ascolto su porta ${port}`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
};

start();
