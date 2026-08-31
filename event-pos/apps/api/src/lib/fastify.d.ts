import { Server } from 'socket.io';

// Augment Fastify instance type so TypeScript knows about fastify.io
declare module 'fastify' {
  interface FastifyInstance {
    io: Server;
  }
}
