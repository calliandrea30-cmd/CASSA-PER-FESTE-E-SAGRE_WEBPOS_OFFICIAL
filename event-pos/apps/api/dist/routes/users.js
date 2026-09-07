"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = default_1;
const prisma_1 = __importDefault(require("../lib/prisma"));
async function default_1(fastify) {
    // ── GET /users ────────────────────────────────────────────────────────────
    fastify.get('/users', async (request, reply) => {
        const { eventId } = request.query;
        if (!eventId)
            return reply.code(400).send({ error: 'eventId required' });
        return prisma_1.default.user.findMany({
            where: { eventId },
            select: { id: true, username: true, role: true, createdAt: true }, // non esporre password/pin
        });
    });
    // ── POST /users ───────────────────────────────────────────────────────────
    fastify.post('/users', async (request, reply) => {
        const { eventId, username, password, pin, role } = request.body;
        if (!eventId || !username || !password || !role) {
            return reply.code(400).send({ error: 'eventId, username, password e role required' });
        }
        const user = await prisma_1.default.user.create({
            data: { eventId, username, password, pin, role },
            select: { id: true, username: true, role: true, createdAt: true },
        });
        return reply.code(201).send(user);
    });
}
