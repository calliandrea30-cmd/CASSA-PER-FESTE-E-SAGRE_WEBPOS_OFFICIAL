import { FastifyInstance } from 'fastify';
import prisma from '../lib/prisma';

export default async function (fastify: FastifyInstance) {

  const getCurrentSession = async (eventId: string, stationId?: string) => {
    let session = await prisma.cashSession.findFirst({
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
      session = await prisma.cashSession.create({
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

  const calculateSessionMetrics = (session: any) => {
    let totalGross = 0;
    let totalNet = 0;
    let totalDiscount = 0;
    const categoryBreakdown: Record<string, number> = {};
    const productStats: Record<string, { qty: number; total: number }> = {};
    const paymentBreakdown: Record<string, number> = { CASH: 0, CARD: 0 };

    session.orders.forEach((o: any) => {
      let orderGross = 0;
      o.items.forEach((item: any) => {
        const lineTotal = item.priceAtTime * item.quantity;
        orderGross += lineTotal;

        const catName = item.product.category?.name || 'Generico';
        categoryBreakdown[catName] = (categoryBreakdown[catName] ?? 0) + lineTotal;

        const prodName = item.variantName
          ? `${item.product.name} [${item.variantName}]`
          : item.product.name;
        if (!productStats[prodName]) productStats[prodName] = { qty: 0, total: 0 };
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
  fastify.get('/sessions/current', async (request: any, reply) => {
    const { eventId, stationId } = request.query;
    if (!eventId) return reply.code(400).send({ error: 'eventId required' });

    const session = await getCurrentSession(eventId, stationId || undefined);
    return calculateSessionMetrics(session);
  });

  // ── POST /sessions/print-x ────────────────────────────────────────────────
  fastify.post('/sessions/print-x', async (request: any, reply) => {
    const { eventId, initialCash = 0 } = request.body;
    if (!eventId) return reply.code(400).send({ error: 'eventId required' });

    const session = await getCurrentSession(eventId);
    const metrics = calculateSessionMetrics(session);
    metrics.initialCash = Number(initialCash);
    const settings = await prisma.setting.findUnique({ where: { id: 'default' } });
    const printerConfigs = await prisma.printerConfig.findMany({
      where: { station: { eventId } },
    });

    const printJob = await prisma.printJob.create({
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
    } else {
      fastify.io.emit('print-job', printJob);
    }
    // Se nessun agent connesso, il job è in DB con status QUEUED.

    return { status: 'ok' };
  });

  // ── POST /sessions/close ──────────────────────────────────────────────────
  fastify.post('/sessions/close', async (request: any, reply) => {
    const { eventId, initialCash = 0 } = request.body;  // ← BUG FIX: initialCash era undefined
    if (!eventId) return reply.code(400).send({ error: 'eventId required' });

    const session = await getCurrentSession(eventId);
    const metrics = calculateSessionMetrics(session);
    metrics.initialCash = Number(initialCash);

    // Chiudi la sessione
    await prisma.cashSession.update({
      where: { id: session.id },
      data: {
        status: 'CLOSED',
        closedAt: new Date(),
        initialCash: Number(initialCash),  // ← BUG FIX: ora è definita
      },
    });

    // Stampa Z
    const settings = await prisma.setting.findUnique({ where: { id: 'default' } });
    const printerConfigs = await prisma.printerConfig.findMany({
      where: { station: { eventId } },
    });
    const printJob = await prisma.printJob.create({
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
    } else {
      fastify.io.emit('print-job', printJob);
    }


    // Apri nuova sessione
    await prisma.cashSession.create({ data: { eventId, status: 'OPEN' } });

    return { status: 'closed', metrics };
  });
}
