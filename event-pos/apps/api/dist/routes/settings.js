"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = default_1;
const prisma_1 = __importDefault(require("../lib/prisma"));
async function default_1(fastify) {
    // ── GET /settings ─────────────────────────────────────────────────────────
    fastify.get('/settings', async () => {
        const setting = await prisma_1.default.setting.upsert({
            where: { id: 'default' },
            update: {},
            create: { id: 'default' },
        });
        return setting;
    });
    // ── PUT /settings ─────────────────────────────────────────────────────────
    fastify.put('/settings', async (request, reply) => {
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
            const safeData = {};
            for (const key of VALID_SETTING_KEYS) {
                if (key in data && data[key] !== undefined) {
                    safeData[key] = data[key];
                }
            }
            const updated = await prisma_1.default.setting.upsert({
                where: { id: 'default' },
                update: safeData,
                create: { id: 'default', ...safeData },
            });
            return updated;
        }
        catch (err) {
            reply.status(500).send({ error: err.message || 'Errore salvataggio impostazioni' });
        }
    });
    // ── POST /settings/print-test ─────────────────────────────────────────────
    fastify.post('/settings/print-test', async (request) => {
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
        const printerConfigs = await prisma_1.default.printerConfig.findMany();
        const printJob = await prisma_1.default.printJob.create({
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
