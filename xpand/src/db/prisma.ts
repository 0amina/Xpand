import { PrismaClient } from '@prisma/client';

import { isProduction } from '../config/env.js';

/**
 * Prisma client singleton — lazily constructed.
 *
 * Two problems are solved here:
 *
 * 1. Single instance / hot reload. With `tsx watch` the module graph re-evaluates on every
 *    change. Caching the instance on `globalThis` prevents each reload from opening a new
 *    PrismaClient and exhausting the DB connection pool. In production the module loads once,
 *    so the cache is a harmless no-op.
 *
 * 2. Boot before `prisma generate`. Until the client has been generated from a schema,
 *    `new PrismaClient()` throws at construction time. If we instantiated eagerly at import,
 *    the whole server would crash on startup in a fresh checkout — even for routes that never
 *    touch the database (e.g. /health). So construction is deferred to first actual use via a
 *    Proxy: import-time is side-effect free, and the client is created only when a query runs.
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

let instance: PrismaClient | undefined = globalForPrisma.prisma;

function getClient(): PrismaClient {
  if (!instance) {
    instance = new PrismaClient({
      log: ['warn', 'error'],
    });
    if (!isProduction) {
      globalForPrisma.prisma = instance;
    }
  }
  return instance;
}

/**
 * The exported singleton. Accessing any property (a model, `$transaction`, `$connect`, ...)
 * triggers construction on first touch, then delegates to the real client. Methods are bound
 * so `this` stays correct when they're destructured or passed around.
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, property, receiver) {
    const client = getClient();
    const value = Reflect.get(client, property, receiver);
    return typeof value === 'function' ? value.bind(client) : value;
  },
});

/**
 * Close the connection pool during shutdown. No-ops if the client was never constructed —
 * important so graceful shutdown doesn't accidentally instantiate (and possibly crash on) an
 * ungenerated client just to disconnect it.
 */
export async function disconnectPrisma(): Promise<void> {
  if (instance) {
    await instance.$disconnect();
  }
}
