import { FastifyInstance } from 'fastify';
import prisma from '../lib/prisma';

export default async function (fastify: FastifyInstance) {

  // ── GET /settings ─────────────────────────────────────────────────────────
  fastify.get('/settings', async () => {
    const setting = await prisma.setting.upsert({
      where: { id: 'default' },
      update: {},
      create: { id: 'default' },
    });
    return setting;
  });

  // ── PUT /settings ─────────────────────────────────────────────────────────
  fastify.put('/settings', async (request: any) => {
    const data = request.body;

    // Rimuoviamo campi non previsti dallo schema per evitare errori Prisma
    const { id: _id, createdAt: _c, updatedAt: _u, ...safeData } = data;

    return prisma.setting.upsert({
      where: { id: 'default' },
      update: safeData,
      create: { id: 'default', ...safeData },
    });
  });

  // ── POST /settings/print-test ─────────────────────────────────────────────
  fastify.post('/settings/print-test', async (request: any) => {
    const data = request.body;

    const mockOrder = {
      orderNumber: 9999,
      createdAt: new Date(),
      totalAmount: 18.50,
      paymentType: 'CASH',
      customerName: 'Test Cliente',
      items: [
        {
          id: 'test-1',
          quantity: 1,
          priceAtTime: 12.00,
          variantName: 'Rossa',
          product: { name: 'Birra Media', category: { name: 'Bar' }, isCombo: false },
        },
        {
          id: 'test-2',
          quantity: 1,
          priceAtTime: 6.50,
          variantName: null,
          product: { name: 'Panino Salsiccia', category: { name: 'Cucina' }, isCombo: false },
        },
      ],
    };

    const printerConfigs = await prisma.printerConfig.findMany();

    const printJob = await prisma.printJob.create({
      data: {
        orderId: 'test-order-id',
        printerId: 'CASHIER',
        payload: JSON.stringify({ ...mockOrder, settings: data, printerConfigs }),
      },
    });

    fastify.io.to('print-agents').emit('print-job', printJob);
    fastify.io.emit('print-job', printJob);
    return { status: 'ok' };
  });
}

