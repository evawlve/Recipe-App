import { prisma } from '../src/lib/db';

async function run() {
  try {
    const count = await prisma.recipe.count();
    console.log('✅ Connected successfully! Recipe count:', count);
  } catch (e) {
    console.error('❌ Connection error:', e);
  } finally {
    await prisma.$disconnect();
  }
}
run();
