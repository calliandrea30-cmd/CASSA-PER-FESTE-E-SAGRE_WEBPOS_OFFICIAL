"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = default_1;
const prisma_1 = __importDefault(require("../lib/prisma"));
async function default_1(fastify) {
    // ── POST /products/:id/availability ──────────────────────────────────────
    fastify.post('/products/:id/availability', async (request, reply) => {
        const { id } = request.params;
        const { available } = request.body;
        const product = await prisma_1.default.product.update({
            where: { id },
            data: { available },
        });
        fastify.io.to(`event:${product.eventId}`).emit('product-availability-changed', {
            productId: product.id,
            available: product.available,
        });
        return product;
    });
    // ── POST /stations/:id/heartbeat ──────────────────────────────────────────
    fastify.post('/stations/:id/heartbeat', async (request, reply) => {
        const { id } = request.params;
        const station = await prisma_1.default.station.update({
            where: { id },
            data: { status: 'ONLINE', lastSeenAt: new Date() },
        });
        fastify.io.to(`event:${station.eventId}`).emit('station-heartbeat', {
            stationId: station.id,
            status: station.status,
            lastSeenAt: station.lastSeenAt,
        });
        return { status: 'ok' };
    });
}
