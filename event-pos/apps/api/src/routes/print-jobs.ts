import { FastifyInstance } from 'fastify';
import prisma from '../lib/prisma';

export default async function (fastify: FastifyInstance) {

  // ── POST /print-jobs/:id/ack ──────────────────────────────────────────────
  // Il print-agent chiama questo endpoint per segnalare che il job è stato stampato.
  fastify.post('/print-jobs/:id/ack', async (request: any, reply) => {
    const { id } = request.params;
    const { status = 'PRINTED', errorMsg } = request.body || {};

    try {
      const job = await prisma.printJob.update({
        where: { id },
        data: {
          status,
          errorMsg: errorMsg || null,
          printedAt: status === 'PRINTED' ? new Date() : null,
        },
      });

      // Notifica i client connessi che il job è stato processato
      if (job.stationId) {
        fastify.io
          .to(`event:${job.stationId}`)
          .emit('print-job-ack', { jobId: id, status });
      }
      fastify.io.emit('print-job-ack', { jobId: id, status });

      return { ok: true };
    } catch (e: any) {
      // Il job potrebbe non esistere (ordine di tipo REPORT)
      return { ok: true };
    }
  });

  // ── GET /print-jobs/pending ───────────────────────────────────────────────
  // Il print-agent può recuperare i job non ancora stampati al riavvio.
  fastify.get('/print-jobs/pending', async (request: any, reply) => {
    const { stationId } = request.query;

    const jobs = await prisma.printJob.findMany({
      where: {
        status: 'QUEUED',
        ...(stationId ? { stationId } : {}),
      },
      orderBy: { createdAt: 'asc' },
      take: 50,
    });

    return jobs;
  });
}
