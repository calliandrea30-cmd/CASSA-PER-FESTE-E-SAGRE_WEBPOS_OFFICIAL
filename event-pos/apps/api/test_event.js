const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const session = await prisma.cashSession.findFirst({ where: { status: 'OPEN' }});
  const allOrders = await prisma.order.findMany();
  console.log("Session eventId:", session.eventId);
  console.log("First Order eventId:", allOrders[0]?.eventId);
}
main();
