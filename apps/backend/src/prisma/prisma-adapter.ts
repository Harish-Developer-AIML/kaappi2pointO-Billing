import { PrismaPg } from '@prisma/adapter-pg';

/**
 * The `pg` driver adapter Prisma uses with engineType = "client". Shared by
 * the Nest PrismaService and standalone scripts (prisma/seed.ts) so both
 * connect the same way, from DATABASE_URL.
 *
 * DATABASE_POOL_MAX caps connections; the Android embedded server sets it low
 * because it shares one small Postgres with nothing else.
 */
export function createPrismaAdapter(): PrismaPg {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set');
  }
  const max = Number(process.env.DATABASE_POOL_MAX) || undefined;
  return new PrismaPg({ connectionString, ...(max ? { max } : {}) });
}
