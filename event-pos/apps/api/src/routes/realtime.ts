import { FastifyInstance } from 'fastify';
import prisma from '../lib/prisma';

export default async function (fastify: FastifyInstance) {

  // ── POST /products/:id/availability ──────────────────────────────────────
  fastify.post('/products/:id/availability', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { available } = request.body as { available: boolean };

    const product = await prisma.product.update({
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
    const { id } = request.params as { id: string };

    const station = await prisma.station.update({
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
