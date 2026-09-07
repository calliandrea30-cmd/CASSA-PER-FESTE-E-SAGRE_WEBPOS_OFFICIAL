"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = default_1;
const prisma_1 = __importDefault(require("../lib/prisma"));
async function default_1(fastify) {
    // ── GET /orders/suspended ─────────────────────────────────────────────────
    fastify.get('/orders/suspended', async (request, reply) => {
        const { eventId, stationId } = request.query;
        if (!eventId)
            return reply.code(400).send({ error: 'eventId required' });
        // Se stationId è specificato, mostra solo i sospesi di quella cassa.
        // Senza stationId mostra tutti (utile per l'admin).
        const where = { eventId, status: 'SUSPENDED' };
        if (stationId)
            where.stationId = stationId;
        return prisma_1.default.order.findMany({
            where,
            include: { items: { include: { product: { include: { category: true } } } } },
            orderBy: { createdAt: 'desc' },
        });
    });
    // ── DELETE /orders/:id ────────────────────────────────────────────────────
    fastify.delete('/orders/:id', async (request, reply) => {
        const { id } = request.params;
        try {
            await prisma_1.default.order.delete({ where: { id } });
            return { ok: true };
        }
        catch (e) {
            return reply.code(404).send({ error: 'Order not found' });
        }
    });
    // ── POST /orders/:id/reprint ──────────────────────────────────────────────
    fastify.post('/orders/:id/reprint', async (request, reply) => {
        const { id } = request.params;
        const order = await prisma_1.default.order.findUnique({
            where: { id },
            include: {
                items: {
                    include: {
                        product: {
                            include: {
                                category: true,
                                comboItems: { include: { component: { include: { category: true } } } },
                            },
                        },
                    },
                },
            },
        });
        if (!order)
            return reply.code(404).send({ error: 'Order not found' });
        const settings = await prisma_1.default.setting.findUnique({ where: { id: 'default' } });
        const printerConfigs = await prisma_1.default.printerConfig.findMany({
            where: { station: { eventId: order.eventId } },
        });
        const printJob = await prisma_1.default.printJob.create({
            data: {
                orderId: order.id,
                stationId: order.stationId,
                printerId: 'CASHIER',
                payload: JSON.stringify({ ...order, isReprint: true, settings, printerConfigs }),
            },
        });
        // Invia alla stanza del print-agent di quella stazione, oppure broadcast
        const room = `print-agent:${order.stationId}`;
        const rooms = fastify.io.sockets.adapter.rooms;
        if (rooms.has(room)) {
            fastify.io.to(room).emit('print-job', printJob);
        }
        else {
            fastify.io.emit('print-job', printJob); // fallback broadcast
        }
        return { ok: true };
    });
    // ── POST /orders/:id/reprint-item/:itemId ─────────────────────────────────
    fastify.post('/orders/:id/reprint-item/:itemId', async (request, reply) => {
        const { id, itemId } = request.params;
        const order = await prisma_1.default.order.findUnique({
            where: { id },
            include: {
                items: {
                    where: { id: itemId },
                    include: {
                        product: {
                            include: {
                                category: true,
                                comboItems: { include: { component: { include: { category: true } } } },
                            },
                        },
                    },
                },
            },
        });
        if (!order)
            return reply.code(404).send({ error: 'Order not found' });
        const settings = await prisma_1.default.setting.findUnique({ where: { id: 'default' } });
        const printerConfigs = await prisma_1.default.printerConfig.findMany({
            where: { station: { eventId: order.eventId } },
        });
        const printJob = await prisma_1.default.printJob.create({
            data: {
                orderId: order.id,
                stationId: order.stationId,
                printerId: 'CASHIER',
                payload: JSON.stringify({ ...order, isReprint: true, settings, isSingleItemReprint: true, printerConfigs }),
            },
        });
        const room = `print-agent:${order.stationId}`;
        const rooms = fastify.io.sockets.adapter.rooms;
        if (rooms.has(room)) {
            fastify.io.to(room).emit('print-job', printJob);
        }
        else {
            fastify.io.emit('print-job', printJob);
        }
        return { ok: true };
    });
    // ── POST /orders/:id/storno ───────────────────────────────────────────────
    fastify.post('/orders/:id/storno', async (request, reply) => {
        const { id } = request.params;
        const existing = await prisma_1.default.order.findUnique({ where: { id } });
        if (!existing)
            return reply.code(404).send({ error: 'Order not found' });
        if (existing.status === 'STORNATO') {
            return reply.code(409).send({ error: 'Ordine già stornato' });
        }
        const order = await prisma_1.default.order.update({
            where: { id },
            data: { status: 'STORNATO' },
            include: {
                items: {
                    include: {
                        product: {
                            include: {
                                category: true,
                                comboItems: { include: { component: { include: { category: true } } } },
                            },
                        },
                    },
                },
            },
        });
        const settings = await prisma_1.default.setting.findUnique({ where: { id: 'default' } });
        const printerConfigs = await prisma_1.default.printerConfig.findMany({
            where: { station: { eventId: order.eventId } },
        });
        // Stampa storno solo se l'ordine era già completato (non sospeso)
        if (existing.status !== 'SUSPENDED') {
            const printJob = await prisma_1.default.printJob.create({
                data: {
                    orderId: order.id,
                    stationId: order.stationId,
                    printerId: 'CASHIER',
                    payload: JSON.stringify({ type: 'STORNO', order, settings, printerConfigs }),
                },
            });
            const room = `print-agent:${order.stationId}`;
            const rooms = fastify.io.sockets.adapter.rooms;
            if (rooms.has(room)) {
                fastify.io.to(room).emit('print-job', printJob);
            }
            else {
                fastify.io.emit('print-job', printJob);
            }
        }
        fastify.io.to(`event:${order.eventId}`).emit('order-stornato', order);
        return order;
    });
    // ── POST /orders ──────────────────────────────────────────────────────────
    fastify.post('/orders', async (request, reply) => {
        const { eventId, stationId, userId, items, paymentType, customerName, status = 'PENDING', discount = 0, } = request.body;
        if (!eventId || !stationId || !userId || !Array.isArray(items) || items.length === 0) {
            return reply.code(400).send({ error: 'eventId, stationId, userId e items sono obbligatori' });
        }
        try {
            // ── Calcolo orderNumber atomico e progressivo ─────────────────────────
            // Usiamo una transazione per garantire assenza di duplicati anche sotto carico.
            const order = await prisma_1.default.$transaction(async (tx) => {
                // Trova o crea la sessione aperta
                let activeSession = await tx.cashSession.findFirst({
                    where: { eventId, status: 'OPEN' },
                });
                if (!activeSession) {
                    activeSession = await tx.cashSession.create({
                        data: { eventId, status: 'OPEN' },
                    });
                }
                // Numero ordine = max nella sessione corrente + 1 (atomico dentro la transazione)
                const lastOrder = await tx.order.findFirst({
                    where: { sessionId: activeSession.id },
                    orderBy: { orderNumber: 'desc' },
                    select: { orderNumber: true },
                });
                const orderNumber = (lastOrder?.orderNumber ?? 0) + 1;
                const totalAmount = Math.max(0, items.reduce((sum, item) => sum + item.price * item.quantity, 0) -
                    Number(discount));
                // Crea ordine
                const newOrder = await tx.order.create({
                    data: {
                        eventId,
                        stationId,
                        userId,
                        status,
                        customerName: customerName || null,
                        paymentType: status === 'SUSPENDED' ? null : paymentType,
                        sessionId: activeSession.id,
                        totalAmount,
                        discount: Number(discount),
                        orderNumber,
                        items: {
                            create: items.map((item) => ({
                                productId: item.productId,
                                variantId: item.variantId || null,
                                variantName: item.variantName || null,
                                note: item.note || null,
                                quantity: item.quantity,
                                priceAtTime: item.price,
                            })),
                        },
                    },
                    include: {
                        items: {
                            include: {
                                product: {
                                    include: {
                                        category: true,
                                        comboItems: { include: { component: { include: { category: true } } } },
                                    },
                                },
                            },
                        },
                    },
                });
                // Decrementa stock e incrementa popolarità (solo per ordini reali, non sospesi)
                if (status !== 'SUSPENDED') {
                    await Promise.all(items.map((item) => tx.product.update({
                        where: { id: item.productId },
                        data: {
                            stock: { decrement: item.quantity },
                            popularity: { increment: item.quantity },
                        },
                    })));
                }
                return newOrder;
            });
            // ── Notifiche real-time ───────────────────────────────────────────────
            fastify.io.to(`event:${eventId}`).emit('new-order', order);
            // Stampa scontrino e comande solo per ordini non sospesi
            if (status !== 'SUSPENDED') {
                const settings = await prisma_1.default.setting.findUnique({ where: { id: 'default' } });
                const printerConfigs = await prisma_1.default.printerConfig.findMany({
                    where: { station: { eventId } },
                });
                const payload = { ...order, settings, printerConfigs };
                // Scontrino cliente e comande articoli → stampante della cassa emittente
                const cashierJob = await prisma_1.default.printJob.create({
                    data: {
                        orderId: order.id,
                        stationId,
                        printerId: 'CASHIER',
                        payload: JSON.stringify(payload),
                    },
                });
                // ── Routing stampa scontrino (CASHIER) ────────────────────────────
                const cashierRoom = `print-agent:${stationId}`;
                const rooms = fastify.io.sockets.adapter.rooms;
                let jobEmitted = false;
                if (rooms.has(cashierRoom)) {
                    fastify.io.to(cashierRoom).emit('print-job', cashierJob);
                    jobEmitted = true;
                }
                if (rooms.has('print-agents')) {
                    fastify.io.to('print-agents').emit('print-job', cashierJob);
                    jobEmitted = true;
                }
                // Fallback di sicurezza: invio broadcast a tutti i socket per garantire che nessuna stampa venga persa
                if (!jobEmitted) {
                    fastify.io.emit('print-job', cashierJob);
                }
                // ── Stampa remota nei singoli distretti (Cucina, Bar, ecc.) ───────
                // Inviata SOLO se abilitata nelle impostazioni di stampa!
                if (settings?.printToDepartments) {
                    const kitchenJob = await prisma_1.default.printJob.create({
                        data: {
                            orderId: order.id,
                            stationId,
                            printerId: 'KITCHEN',
                            payload: JSON.stringify(payload),
                        },
                    });
                    if (rooms.has('print-agents')) {
                        fastify.io.to('print-agents').emit('print-job', kitchenJob);
                    }
                    else {
                        fastify.io.emit('print-job', kitchenJob);
                    }
                }
            }
            return reply.code(201).send(order);
        }
        catch (e) {
            fastify.log.error(e);
            return reply.code(500).send({ error: 'Creazione ordine fallita', detail: e?.message });
        }
    });
    // ── GET /orders ───────────────────────────────────────────────────────────
    fastify.get('/orders', async (request, reply) => {
        const { eventId, date } = request.query;
        if (!eventId)
            return reply.code(400).send({ error: 'eventId required' });
        const where = { eventId };
        if (date) {
            const start = new Date(date);
            start.setHours(0, 0, 0, 0);
            const end = new Date(date);
            end.setHours(23, 59, 59, 999);
            where.createdAt = { gte: start, lte: end };
        }
        return prisma_1.default.order.findMany({
            where,
            include: {
                items: {
                    include: {
                        product: {
                            include: {
                                category: true,
                                comboItems: { include: { component: { include: { category: true } } } },
                            },
                        },
                    },
                },
            },
            orderBy: { createdAt: 'desc' },
        });
    });
}
