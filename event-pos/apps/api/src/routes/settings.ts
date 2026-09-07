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
  fastify.put('/settings', async (request: any, reply) => {
    try {
      const data = request.body || {};

      const VALID_SETTING_KEYS = [
        'headerName',
        'headerSubtitle',
        'headerAddress',
        'headerVat',
        'headerPhone',
        'headerAlign',
        'headerSize',
        'bodyFont',
        'showOriginalPrice',
        'showChangeAndDiscount',
        'dateFormat',
        'prepItemSize',
        'prepNoteSize',
        'prepShowMetadata',
        'prepVariantFormat',
        'footerText',
        'footerShowCount',
        'printToDepartments',
        'headerLogoBase64',
        'footerLogoBase64',
        'comandaGreeting',
        'comandaShowHeader',
        'comandaShowPrice',
      ];

      const safeData: any = {};
      for (const key of VALID_SETTING_KEYS) {
        if (key in data && data[key] !== undefined) {
          safeData[key] = data[key];
        }
      }

      const updated = await prisma.setting.upsert({
        where: { id: 'default' },
        update: safeData,
        create: { id: 'default', ...safeData },
      });
      return updated;
    } catch (err: any) {
      reply.status(500).send({ error: err.message || 'Errore salvataggio impostazioni' });
    }
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

