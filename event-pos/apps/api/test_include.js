const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const session = await prisma.cashSession.findFirst({
    where: { status: 'OPEN' },
    include: {
      orders: {
        where: { status: { not: 'STORNATO' } }
      }
    }
  });
  console.log("session.orders.length:", session.orders.length);
}
main();
