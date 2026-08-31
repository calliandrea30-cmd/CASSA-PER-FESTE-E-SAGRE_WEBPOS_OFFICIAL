import { FastifyInstance } from 'fastify';
import prisma from '../lib/prisma';

export default async function (fastify: FastifyInstance) {

  // ── GET /events ───────────────────────────────────────────────────────────
  fastify.get('/events', async () => {
    return prisma.event.findMany({ where: { active: true }, orderBy: { createdAt: 'desc' } });
  });

  // ── POST /events ──────────────────────────────────────────────────────────
  fastify.post('/events', async (request: any, reply) => {
    const { name, date } = request.body;
    if (!name) return reply.code(400).send({ error: 'name required' });

    const event = await prisma.event.create({
      data: { name, date: date ? new Date(date) : null, active: true },
    });
    return reply.code(201).send(event);
  });

  // ── PUT /events/:id ───────────────────────────────────────────────────────
  fastify.put('/events/:id', async (request: any, reply) => {
    const { id } = request.params;
    const { name, date, active } = request.body;

    const event = await prisma.event.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(date !== undefined && { date: date ? new Date(date) : null }),
        ...(active !== undefined && { active }),
      },
    });
    return event;
  });

  // ── GET /stations ─────────────────────────────────────────────────────────
  fastify.get('/stations', async (request: any, reply) => {
    const { eventId } = request.query;
    if (!eventId) return reply.code(400).send({ error: 'eventId required' });

    return prisma.station.findMany({
      where: { eventId },
      include: { printerConfigs: true },
      orderBy: { createdAt: 'asc' },
    });
  });

  // ── POST /stations ────────────────────────────────────────────────────────
  fastify.post('/stations', async (request: any, reply) => {
    const { eventId, name } = request.body;
    if (!eventId || !name) return reply.code(400).send({ error: 'eventId e name required' });

    const station = await prisma.station.create({
      data: { eventId, name, status: 'OFFLINE' },
      include: { printerConfigs: true },
    });
    fastify.io.to(`event:${eventId}`).emit('stations-updated');
    return reply.code(201).send(station);
  });

  // ── PUT /stations/:id ─────────────────────────────────────────────────────
  fastify.put('/stations/:id', async (request: any, reply) => {
    const { id } = request.params;
    const { name, status } = request.body;

    const station = await prisma.station.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(status !== undefined && { status }),
      },
      include: { printerConfigs: true },
    });
    return station;
  });

  // ── DELETE /stations/:id ──────────────────────────────────────────────────
  fastify.delete('/stations/:id', async (request: any, reply) => {
    const { id } = request.params;
    try {
      const orders = await prisma.order.findMany({ where: { stationId: id }, select: { id: true } });
      const orderIds = orders.map(o => o.id);
      if (orderIds.length > 0) {
        await prisma.printJob.deleteMany({ where: { orderId: { in: orderIds } } });
        await prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
        await prisma.order.deleteMany({ where: { stationId: id } });
      }
      await prisma.printJob.deleteMany({ where: { stationId: id } });
      await prisma.printerConfig.deleteMany({ where: { stationId: id } });
      await prisma.station.delete({ where: { id } });
      return { ok: true };
    } catch (e: any) {
      return reply.code(400).send({ error: e?.message || 'Impossibile eliminare la stazione' });
    }
  });

  // ── GET /stations/:id/printers ────────────────────────────────────────────
  fastify.get('/stations/:id/printers', async (request: any, reply) => {
    const { id } = request.params;
    return prisma.printerConfig.findMany({ where: { stationId: id } });
  });

  // ── POST /stations/:id/printers ───────────────────────────────────────────
  fastify.post('/stations/:id/printers', async (request: any, reply) => {
    const { id } = request.params;
    const { name, type, role, usbVendorId, usbProductId, networkHost, networkPort } = request.body as any;

    if (!type || !role) return reply.code(400).send({ error: 'type e role required' });

    const printer = await prisma.printerConfig.create({
      data: {
        stationId: id,
        name: name || 'Stampante',
        type,
        role,
        usbVendorId: usbVendorId != null ? parseInt(String(usbVendorId)) : null,
        usbProductId: usbProductId != null ? parseInt(String(usbProductId)) : null,
        networkHost: networkHost || null,
        networkPort: networkPort ? parseInt(String(networkPort)) : 9100,
      },
    });
    return reply.code(201).send(printer);
  });

  // ── PUT /stations/printers/:printerId ─────────────────────────────────────
  fastify.put('/stations/printers/:printerId', async (request: any, reply) => {
    const { printerId } = request.params;
    const data = request.body as any;

    const printer = await prisma.printerConfig.update({
      where: { id: printerId },
      data: {
        name: data.name,
        type: data.type,
        role: data.role,
        usbVendorId: data.usbVendorId != null ? parseInt(String(data.usbVendorId)) : null,
        usbProductId: data.usbProductId != null ? parseInt(String(data.usbProductId)) : null,
        networkHost: data.networkHost || null,
        networkPort: data.networkPort ? parseInt(String(data.networkPort)) : 9100,
      },
    });
    return printer;
  });

  // ── DELETE /stations/printers/:printerId ──────────────────────────────────
  fastify.delete('/stations/printers/:printerId', async (request: any, reply) => {
    const { printerId } = request.params;
    try {
      await prisma.printerConfig.delete({ where: { id: printerId } });
      return { ok: true };
    } catch (e: any) {
      return reply.code(400).send({ error: e?.message || 'Impossibile eliminare la stampante' });
    }
  });
}
