import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding demo data...');

  const event = await prisma.event.create({
    data: {
      name: 'Sagra del Borgo 2026',
      active: true,
      date: new Date('2026-08-20')
    }
  });

  const usersData = [
    { username: 'admin', role: 'ADMIN', password: 'password', pin: '1111' },
    { username: 'responsabile', role: 'MANAGER', password: 'password', pin: '2222' },
    { username: 'cassa1', role: 'CASHIER', password: 'password', pin: '3333' },
    { username: 'cassa2', role: 'CASHIER', password: 'password', pin: '4444' },
    { username: 'cucina', role: 'KITCHEN', password: 'password', pin: '5555' },
  ];

  for (const u of usersData) {
    await prisma.user.create({
      data: {
        eventId: event.id,
        ...u
      }
    });
  }

  const stationsData = [
    { name: 'Cassa 1', status: 'ONLINE' },
    { name: 'Cassa 2', status: 'ONLINE' }
  ];

  const stations = [];
  for (const s of stationsData) {
    const st = await prisma.station.create({
      data: {
        eventId: event.id,
        ...s
      }
    });
    stations.push(st);
  }

  const catPanini = await prisma.category.create({ data: { eventId: event.id, name: 'Panini', orderIndex: 0 }});
  const catGriglia = await prisma.category.create({ data: { eventId: event.id, name: 'Griglia', orderIndex: 1 }});
  const catContorni = await prisma.category.create({ data: { eventId: event.id, name: 'Contorni', orderIndex: 2 }});
  const catBevande = await prisma.category.create({ data: { eventId: event.id, name: 'Bevande', orderIndex: 3 }});
  const catBirra = await prisma.category.create({ data: { eventId: event.id, name: 'Birra', orderIndex: 4 }});
  const catDolci = await prisma.category.create({ data: { eventId: event.id, name: 'Dolci', orderIndex: 5 }});

  const productsData = [
    { categoryId: catPanini.id, name: 'Panino con salsiccia', price: 6.0, department: 'KITCHEN' },
    { categoryId: catPanini.id, name: 'Panino con porchetta', price: 7.0, department: 'KITCHEN' },
    { categoryId: catGriglia.id, name: 'Hamburger', price: 7.0, department: 'KITCHEN' },
    { categoryId: catContorni.id, name: 'Patatine', price: 3.0, department: 'KITCHEN' },
    { categoryId: catBirra.id, name: 'Birra 0,4L', price: 5.0, department: 'BAR' },
    { categoryId: catBevande.id, name: 'Acqua', price: 1.0, department: 'BAR' },
    { categoryId: catBevande.id, name: 'Coca-Cola', price: 3.0, department: 'BAR' },
    { categoryId: catDolci.id, name: 'Tiramisù', price: 4.0, department: 'KITCHEN' },
  ];

  for (const p of productsData) {
    await prisma.product.create({
      data: {
        eventId: event.id,
        ...p
      }
    });
  }

  console.log('Seeding completed!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
