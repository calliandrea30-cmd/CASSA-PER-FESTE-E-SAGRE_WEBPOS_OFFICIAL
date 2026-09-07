"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fastify_1 = __importDefault(require("fastify"));
const cors_1 = __importDefault(require("@fastify/cors"));
const socket_io_1 = require("socket.io");
const os_1 = __importDefault(require("os"));
const prisma_1 = __importDefault(require("./lib/prisma"));
const catalog_1 = __importDefault(require("./routes/catalog"));
const categories_1 = __importDefault(require("./routes/categories"));
const users_1 = __importDefault(require("./routes/users"));
const settings_1 = __importDefault(require("./routes/settings"));
const orders_1 = __importDefault(require("./routes/orders"));
const sessions_1 = __importDefault(require("./routes/sessions"));
const events_1 = __importDefault(require("./routes/events"));
const realtime_1 = __importDefault(require("./routes/realtime"));
const print_jobs_1 = __importDefault(require("./routes/print-jobs"));
const server = (0, fastify_1.default)({ logger: { level: process.env.LOG_LEVEL || 'info' } });
// ── CORS ──────────────────────────────────────────────────────────────────────
server.register(cors_1.default, { origin: true });
// ── Tolerate empty JSON bodies on DELETE / GET ────────────────────────────────
server.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, defaultDone) => {
    if (!body || (typeof body === 'string' && body.trim().length === 0)) {
        return defaultDone(null, {});
    }
    try {
        const json = JSON.parse(body);
        defaultDone(null, json);
    }
    catch (err) {
        err.statusCode = 400;
        defaultDone(err, undefined);
    }
});
// ── Health check ──────────────────────────────────────────────────────────────
server.get('/health', async () => ({ status: 'ok', ts: Date.now() }));
// ── Server Info (usato dal launcher per rilevare IP locale) ───────────────────
server.get('/api/server-info', async () => {
    const localIPs = [];
    try {
        for (const [, addrs] of Object.entries(os_1.default.networkInterfaces())) {
            for (const a of addrs ?? []) {
                if (a.family === 'IPv4' && !a.internal)
                    localIPs.push(a.address);
            }
        }
    }
    catch { }
    return {
        status: 'ok',
        version: '2.0.0',
        localIPs,
        port: parseInt(process.env.PORT || '3001', 10),
        hostname: os_1.default.hostname(),
    };
});
// ── Socket.IO ─────────────────────────────────────────────────────────────────
const io = new socket_io_1.Server({
    cors: { origin: '*', methods: ['GET', 'POST'] },
    pingTimeout: 20000,
    pingInterval: 10000,
});
server.decorate('io', io);
// ── Routes ────────────────────────────────────────────────────────────────────
server.register(catalog_1.default, { prefix: '/api' });
server.register(categories_1.default, { prefix: '/api' });
server.register(users_1.default, { prefix: '/api' });
server.register(settings_1.default, { prefix: '/api' });
server.register(orders_1.default, { prefix: '/api' });
server.register(sessions_1.default, { prefix: '/api' });
server.register(events_1.default, { prefix: '/api' });
server.register(realtime_1.default, { prefix: '/api' });
server.register(print_jobs_1.default, { prefix: '/api' });
// ── Auto-seed: crea evento + stazione + utente di default se il DB è vuoto ───
async function autoSeed() {
    try {
        const eventCount = await prisma_1.default.event.count();
        if (eventCount > 0)
            return; // già inizializzato
        server.log.info('[AutoSeed] Nessun evento trovato. Creo configurazione di default...');
        const event = await prisma_1.default.event.create({
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
        await prisma_1.default.setting.upsert({
            where: { id: 'default' },
            update: {},
            create: { id: 'default' },
        });
        server.log.info(`[AutoSeed] ✅ Evento default creato: ${event.id}`);
    }
    catch (err) {
        server.log.error(`[AutoSeed] Errore durante auto-seed: ${String(err)}`);
    }
}
// ── Socket logic ──────────────────────────────────────────────────────────────
function setupSocketHandlers() {
    io.on('connection', (socket) => {
        server.log.info(`[Socket] Client connesso: ${socket.id}`);
        // Il client si unisce alla stanza del proprio evento per ricevere
        // solo gli aggiornamenti rilevanti.
        socket.on('join-event', (eventId) => {
            socket.join(`event:${eventId}`);
            server.log.info(`[Socket] ${socket.id} joined event:${eventId}`);
        });
        // Il print-agent si registra con la propria stationId
        socket.on('print-agent-register', (data) => {
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
    }
    catch (err) {
        server.log.error(err);
        process.exit(1);
    }
};
start();
