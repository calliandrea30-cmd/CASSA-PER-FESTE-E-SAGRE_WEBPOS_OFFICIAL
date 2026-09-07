"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = default_1;
const prisma_1 = __importDefault(require("../lib/prisma"));
async function default_1(fastify) {
    // ── POST /categories ──────────────────────────────────────────────────────
    fastify.post('/categories', async (request, reply) => {
        const { eventId, name, orderIndex, quickNotes, printRole } = request.body;
        if (!eventId || !name)
            return reply.code(400).send({ error: 'eventId e name required' });
        const cat = await prisma_1.default.category.create({
            data: { eventId, name, orderIndex: orderIndex ?? 0, quickNotes, printRole },
        });
        fastify.io.to(`event:${eventId}`).emit('category-updated');
        return reply.code(201).send(cat);
    });
    // ── PUT /categories/:id ───────────────────────────────────────────────────
    fastify.put('/categories/:id', async (request, reply) => {
        const { id } = request.params;
        const { name, orderIndex, quickNotes, printRole } = request.body;
        const cat = await prisma_1.default.category.update({
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
        const { id } = request.params;
        const productsCount = await prisma_1.default.product.count({ where: { categoryId: id } });
        if (productsCount > 0) {
            return reply.code(400).send({
                error: 'Impossibile eliminare: ci sono prodotti associati a questa categoria.',
            });
        }
        const cat = await prisma_1.default.category.delete({ where: { id } });
        fastify.io.to(`event:${cat.eventId}`).emit('category-updated');
        return reply.code(200).send({ success: true });
    });
}
