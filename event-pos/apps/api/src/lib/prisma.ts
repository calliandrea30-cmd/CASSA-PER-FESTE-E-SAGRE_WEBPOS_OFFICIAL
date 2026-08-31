import { PrismaClient } from '@prisma/client';

// Singleton pattern: una sola connessione al DB per tutto il processo.
// Evita il problema di connessioni multiple con SQLite (lock / corruzione).
const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

export default prisma;
