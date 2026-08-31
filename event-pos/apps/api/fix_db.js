const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const activeSession = await prisma.cashSession.findFirst({ where: { status: 'OPEN' }});
  if (activeSession) {
    const updated = await prisma.order.updateMany({
      where: { sessionId: null },
      data: { sessionId: activeSession.id }
    });
    console.log("Updated orders:", updated.count);
  }
}
main().catch(console.error).finally(() => prisma.$disconnect());
