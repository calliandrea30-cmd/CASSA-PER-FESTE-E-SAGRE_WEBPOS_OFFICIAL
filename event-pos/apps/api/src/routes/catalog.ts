import { FastifyInstance } from 'fastify';
import prisma from '../lib/prisma';

export default async function (fastify: FastifyInstance) {

  // ── GET /categories ───────────────────────────────────────────────────────
  fastify.get('/categories', async (request, reply) => {
    const { eventId } = request.query as { eventId: string };
    if (!eventId) return reply.code(400).send({ error: 'eventId required' });

    return prisma.category.findMany({
      where: { eventId },
      orderBy: { orderIndex: 'asc' },
    });
  });

  // ── GET /products ─────────────────────────────────────────────────────────
  fastify.get('/products', async (request, reply) => {
    const { eventId, all } = request.query as { eventId: string; all?: string };
    if (!eventId) return reply.code(400).send({ error: 'eventId required' });

    const where: any = { eventId };
    if (all !== 'true') where.available = true;

    return prisma.product.findMany({
      where,
      include: {
        variants: true,
        category: true,
        comboItems: { include: { component: { include: { category: true } } } },
      },
      orderBy: [{ category: { orderIndex: 'asc' } }, { name: 'asc' }],
    });
  });

  // ── PUT /products/:id ─────────────────────────────────────────────────────
  fastify.put('/products/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { name, categoryId, price, stock, available, variants, isCombo, comboItems } = request.body as any;

    const updatedProduct = await prisma.product.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(categoryId !== undefined && { categoryId }),
        ...(price !== undefined && { price: parseFloat(price) }),
        ...(stock !== undefined && { stock: parseInt(stock) }),
        ...(available !== undefined && { available }),
        ...(isCombo !== undefined && { isCombo: Boolean(isCombo) }),
      },
    });

    if (variants !== undefined && Array.isArray(variants)) {
      await prisma.productVariant.deleteMany({ where: { productId: id } });
      if (variants.length > 0) {
        await prisma.productVariant.createMany({
          data: variants.map((v: any) => ({
            productId: id,
            name: v.name,
            priceDelta: parseFloat(v.priceDelta || 0),
          })),
        });
      }
    }

    if (isCombo && comboItems !== undefined && Array.isArray(comboItems)) {
      await prisma.comboItem.deleteMany({ where: { comboId: id } });
      if (comboItems.length > 0) {
        await prisma.comboItem.createMany({
          data: comboItems.map((ci: any) => ({
            comboId: id,
            componentId: ci.componentId,
            quantity: parseInt(ci.quantity) || 1,
          })),
        });
      }
    } else if (!isCombo) {
      await prisma.comboItem.deleteMany({ where: { comboId: id } });
    }

    fastify.io.to(`event:${updatedProduct.eventId}`).emit('product-updated', {
      productId: id,
      stock: updatedProduct.stock,
      available: updatedProduct.available,
      name: updatedProduct.name,
      price: updatedProduct.price,
    });

    return prisma.product.findUnique({
      where: { id },
      include: {
        variants: true,
        category: true,
        comboItems: { include: { component: { include: { category: true } } } },
      },
    });
  });

  // ── DELETE /products/:id ──────────────────────────────────────────────────
  fastify.delete('/products/:id', async (request, reply) => {
    const { id } = request.params as { id: string };

    try {
      const product = await prisma.product.findUnique({ where: { id }, select: { eventId: true } });
      await prisma.product.delete({ where: { id } });
      if (product) {
        fastify.io.to(`event:${product.eventId}`).emit('product-deleted', { productId: id });
      }
    } catch {
      // Ha ordini collegati: segna come non disponibile invece di eliminare
      const product = await prisma.product.update({
        where: { id },
        data: { available: false },
      });
      fastify.io.to(`event:${product.eventId}`).emit('product-updated', { productId: id, available: false });
    }

    return reply.code(200).send({ success: true });
  });

  // ── POST /products ────────────────────────────────────────────────────────
  fastify.post('/products', async (request, reply) => {
    const { eventId, categoryId, name, price, stock, variants, isCombo, comboItems } = request.body as any;

    if (!eventId || !name) return reply.code(400).send({ error: 'eventId e name required' });

    let cid = categoryId;
    if (!cid) {
      const cat = await prisma.category.findFirst({ where: { eventId } });
      if (!cat) return reply.code(400).send({ error: 'Nessuna categoria disponibile per questo evento' });
      cid = cat.id;
    }

    const product = await prisma.product.create({
      data: {
        eventId,
        categoryId: cid,
        name,
        price: parseFloat(price) || 0,
        stock: parseInt(stock) ?? 999,
        isCombo: Boolean(isCombo),
        comboItems:
          isCombo && comboItems?.length > 0
            ? { create: comboItems.map((ci: any) => ({ componentId: ci.componentId, quantity: parseInt(ci.quantity) || 1 })) }
            : undefined,
        variants:
          variants?.length > 0
            ? { create: variants.map((v: any) => ({ name: v.name, priceDelta: parseFloat(v.priceDelta || 0) })) }
            : undefined,
      },
      include: {
        variants: true,
        category: true,
        comboItems: { include: { component: { include: { category: true } } } },
      },
    });

    fastify.io.to(`event:${eventId}`).emit('new-product', product);
    return reply.code(201).send(product);
  });

  // ── POST /products/bulk ───────────────────────────────────────────────────
  fastify.post('/products/bulk', async (request, reply) => {
    const { eventId, products } = request.body as { eventId: string; products: any[] };
    if (!eventId || !Array.isArray(products)) {
      return reply.code(400).send({ error: 'eventId e products[] required' });
    }

    const created = [];
    for (const p of products) {
      let cid = p.categoryId;
      if (!cid && p.categoryName) {
        let cat = await prisma.category.findFirst({ where: { eventId, name: p.categoryName } });
        if (!cat) {
          cat = await prisma.category.create({
            data: { eventId, name: p.categoryName, orderIndex: 0 },
          });
        }
        cid = cat.id;
      }
      if (!cid) {
        let cat = await prisma.category.findFirst({ where: { eventId } });
        if (!cat) cat = await prisma.category.create({ data: { eventId, name: 'Generale', orderIndex: 0 } });
        cid = cat.id;
      }

      const prod = await prisma.product.create({
        data: {
          eventId,
          categoryId: cid,
          name: p.name,
          price: parseFloat(p.price) || 0,
          stock: parseInt(p.stock) ?? 999,
          variants:
            p.variants?.length > 0
              ? { create: p.variants.map((v: any) => ({ name: v.name, priceDelta: parseFloat(v.priceDelta || 0) })) }
              : undefined,
        },
        include: {
          variants: true,
          category: true,
          comboItems: { include: { component: { include: { category: true } } } },
        },
      });
      created.push(prod);
    }

    fastify.io.to(`event:${eventId}`).emit('bulk-products-created', { count: created.length });
    return reply.code(201).send(created);
  });
}
