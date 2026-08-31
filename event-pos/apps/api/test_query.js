const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient({ log: ['query'] });
async function main() {
  await prisma.cashSession.findFirst({
    where: { status: 'OPEN' },
    include: {
      orders: {
        where: { status: { not: 'STORNATO' } }
      }
    }
  });
}
main();
