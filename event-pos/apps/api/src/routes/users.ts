import { FastifyInstance } from 'fastify';
import prisma from '../lib/prisma';

export default async function (fastify: FastifyInstance) {

  // ── GET /users ────────────────────────────────────────────────────────────
  fastify.get('/users', async (request, reply) => {
    const { eventId } = request.query as { eventId: string };
    if (!eventId) return reply.code(400).send({ error: 'eventId required' });

    return prisma.user.findMany({
      where: { eventId },
      select: { id: true, username: true, role: true, createdAt: true }, // non esporre password/pin
    });
  });

  // ── POST /users ───────────────────────────────────────────────────────────
  fastify.post('/users', async (request: any, reply) => {
    const { eventId, username, password, pin, role } = request.body;
    if (!eventId || !username || !password || !role) {
      return reply.code(400).send({ error: 'eventId, username, password e role required' });
    }

    const user = await prisma.user.create({
      data: { eventId, username, password, pin, role },
      select: { id: true, username: true, role: true, createdAt: true },
    });
    return reply.code(201).send(user);
  });
}
