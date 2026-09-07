"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = default_1;
const prisma_1 = __importDefault(require("../lib/prisma"));
async function default_1(fastify) {
    const getCurrentSession = async (eventId, stationId) => {
        let session = await prisma_1.default.cashSession.findFirst({
            where: { eventId, status: 'OPEN' },
            include: {
                orders: {
                    where: {
                        status: { not: 'STORNATO' },
                        ...(stationId ? { stationId } : {}),
                    },
                    include: {
                        items: {
                            include: { product: { include: { category: true } } },
                        },
                    },
                },
            },
        });
        if (!session) {
            session = await prisma_1.default.cashSession.create({
                data: { eventId, status: 'OPEN' },
                include: {
                    orders: {
                        include: { items: { include: { product: { include: { category: true } } } } },
                    },
                },
            });
        }
        return session;
    };
    const calculateSessionMetrics = (session) => {
        let totalGross = 0;
        let totalNet = 0;
        let totalDiscount = 0;
        const categoryBreakdown = {};
        const productStats = {};
        const paymentBreakdown = { CASH: 0, CARD: 0 };
        session.orders.forEach((o) => {
            let orderGross = 0;
            o.items.forEach((item) => {
                const lineTotal = item.priceAtTime * item.quantity;
                orderGross += lineTotal;
                const catName = item.product.category?.name || 'Generico';
                categoryBreakdown[catName] = (categoryBreakdown[catName] ?? 0) + lineTotal;
                const prodName = item.variantName
                    ? `${item.product.name} [${item.variantName}]`
                    : item.product.name;
                if (!productStats[prodName])
                    productStats[prodName] = { qty: 0, total: 0 };
                productStats[prodName].qty += item.quantity;
                productStats[prodName].total += lineTotal;
            });
            totalGross += orderGross;
            totalNet += o.totalAmount;
            if (o.paymentType && paymentBreakdown[o.paymentType] !== undefined) {
                paymentBreakdown[o.paymentType] += o.totalAmount;
            }
        });
        totalDiscount = totalGross - totalNet;
        return {
            id: session.id,
            openedAt: session.openedAt,
            initialCash: session.initialCash,
            orderCount: session.orders.length,
            totalGross,
            totalNet,
            totalDiscount,
            paymentBreakdown,
            categoryBreakdown,
            productStats,
        };
    };
    // ── GET /sessions/current ─────────────────────────────────────────────────
    fastify.get('/sessions/current', async (request, reply) => {
        const { eventId, stationId } = request.query;
        if (!eventId)
            return reply.code(400).send({ error: 'eventId required' });
        const session = await getCurrentSession(eventId, stationId || undefined);
        return calculateSessionMetrics(session);
    });
    // ── POST /sessions/print-x ────────────────────────────────────────────────
    fastify.post('/sessions/print-x', async (request, reply) => {
        const { eventId, initialCash = 0 } = request.body;
        if (!eventId)
            return reply.code(400).send({ error: 'eventId required' });
        const session = await getCurrentSession(eventId);
        const metrics = calculateSessionMetrics(session);
        metrics.initialCash = Number(initialCash);
        const settings = await prisma_1.default.setting.findUnique({ where: { id: 'default' } });
        const printerConfigs = await prisma_1.default.printerConfig.findMany({
            where: { station: { eventId } },
        });
        const printJob = await prisma_1.default.printJob.create({
            data: {
                orderId: 'REPORT-X',
                printerId: 'CASHIER',
                payload: JSON.stringify({ type: 'REPORT_X', reportData: metrics, settings, printerConfigs }),
            },
        });
        // Emetti il job ai print-agent connessi
        const rooms = fastify.io.sockets.adapter.rooms;
        if (rooms.has('print-agents')) {
            fastify.io.to('print-agents').emit('print-job', printJob);
        }
        else {
            fastify.io.emit('print-job', printJob);
        }
        // Se nessun agent connesso, il job è in DB con status QUEUED.
        return { status: 'ok' };
    });
    // ── POST /sessions/close ──────────────────────────────────────────────────
    fastify.post('/sessions/close', async (request, reply) => {
        const { eventId, initialCash = 0 } = request.body; // ← BUG FIX: initialCash era undefined
        if (!eventId)
            return reply.code(400).send({ error: 'eventId required' });
        const session = await getCurrentSession(eventId);
        const metrics = calculateSessionMetrics(session);
        metrics.initialCash = Number(initialCash);
        // Chiudi la sessione
        await prisma_1.default.cashSession.update({
            where: { id: session.id },
            data: {
                status: 'CLOSED',
                closedAt: new Date(),
                initialCash: Number(initialCash), // ← BUG FIX: ora è definita
            },
        });
        // Stampa Z
        const settings = await prisma_1.default.setting.findUnique({ where: { id: 'default' } });
        const printerConfigs = await prisma_1.default.printerConfig.findMany({
            where: { station: { eventId } },
        });
        const printJob = await prisma_1.default.printJob.create({
            data: {
                orderId: 'REPORT-Z',
                printerId: 'CASHIER',
                payload: JSON.stringify({ type: 'REPORT_Z', reportData: metrics, settings, printerConfigs }),
            },
        });
        // Emetti il job ai print-agent connessi
        const rooms2 = fastify.io.sockets.adapter.rooms;
        if (rooms2.has('print-agents')) {
            fastify.io.to('print-agents').emit('print-job', printJob);
        }
        else {
            fastify.io.emit('print-job', printJob);
        }
        // Apri nuova sessione
        await prisma_1.default.cashSession.create({ data: { eventId, status: 'OPEN' } });
        return { status: 'closed', metrics };
    });
}
