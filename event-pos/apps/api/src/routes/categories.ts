import { FastifyInstance } from 'fastify';
import prisma from '../lib/prisma';

export default async function (fastify: FastifyInstance) {

  // ── POST /categories ──────────────────────────────────────────────────────
  fastify.post('/categories', async (request, reply) => {
    const { eventId, name, orderIndex, quickNotes, printRole } = request.body as any;
    if (!eventId || !name) return reply.code(400).send({ error: 'eventId e name required' });

    const cat = await prisma.category.create({
      data: { eventId, name, orderIndex: orderIndex ?? 0, quickNotes, printRole },
    });
    fastify.io.to(`event:${eventId}`).emit('category-updated');
    return reply.code(201).send(cat);
  });

  // ── PUT /categories/:id ───────────────────────────────────────────────────
  fastify.put('/categories/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { name, orderIndex, quickNotes, printRole } = request.body as any;

    const cat = await prisma.category.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(orderIndex !== undefined && { orderIndex }),
        ...(quickNotes !== undefined && { quickNotes }),
        ...(printRole !== undefined && { printRole }),
      },
    });
    fastify.io.to(`event:${cat.eventId}`).emit('category-updated');
    return reply.code(200).send(cat);
  });

  // ── DELETE /categories/:id ────────────────────────────────────────────────
  fastify.delete('/categories/:id', async (request, reply) => {
    const { id } = request.params as { id: string };

    const productsCount = await prisma.product.count({ where: { categoryId: id } });
    if (productsCount > 0) {
      return reply.code(400).send({
        error: 'Impossibile eliminare: ci sono prodotti associati a questa categoria.',
      });
    }

    const cat = await prisma.category.delete({ where: { id } });
    fastify.io.to(`event:${cat.eventId}`).emit('category-updated');
    return reply.code(200).send({ success: true });
  });
}
