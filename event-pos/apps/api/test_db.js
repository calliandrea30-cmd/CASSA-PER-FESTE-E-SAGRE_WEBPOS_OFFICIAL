const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const session = await prisma.cashSession.findFirst({ where: { status: 'OPEN' }, include: { orders: true }});
  console.log("Session ID:", session.id);
  console.log("Orders count:", session.orders.length);
  const allOrders = await prisma.order.findMany();
  console.log("All orders length:", allOrders.length);
  console.log("Orders with sessionId matching active:", allOrders.filter(o => o.sessionId === session.id).length);
  console.log("Orders with status PENDING:", allOrders.filter(o => o.status === 'PENDING').length);
  console.log("Orders with status not STORNATO:", allOrders.filter(o => o.status !== 'STORNATO').length);
}
main();
