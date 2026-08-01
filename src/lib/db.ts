import { PrismaClient } from "@prisma/client";
import { attachPrismaSentry } from "@/lib/obs/prismaSentry";

const globalForPrisma = global as unknown as { prisma: PrismaClient };

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    // Prisma's `query` stream is OFF by default. Measured 2026-08-01 on the box:
    // 909,552 of the 976,124 lines in ~/Recipe-App/logs/next-start.log (93.2%)
    // begin with `prisma:query`, against 9,195 structured lines of our own. A
    // 596MB unrotated log that is 93% raw SQL is not greppable, which is what
    // made every other observability question unanswerable. Set
    // PRISMA_LOG_QUERIES=1 and restart to get it back for a debugging window.
    log: process.env.PRISMA_LOG_QUERIES === '1'
      ? ['query', 'error', 'warn']
      : ['error', 'warn'],
    datasources: {
      db: {
        // Prefer direct URL (unpooled) when available to avoid pgBouncer constraints in dev
        url: process.env.DIRECT_URL || process.env.DATABASE_URL,
      },
    },
  });

// Attach Sentry middleware for observability (guard prevents double installation)
if (!globalForPrisma.prisma) {
  attachPrismaSentry(prisma);
}

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

// Graceful shutdown
process.on('beforeExit', async () => {
  await prisma.$disconnect();
});

process.on('SIGINT', async () => {
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await prisma.$disconnect();
  process.exit(0);
});
