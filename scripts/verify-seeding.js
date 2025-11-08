/**
 * Verify database seeding - checks that foods were created
 * Usage: node scripts/verify-seeding.js
 */

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  try {
    const count = await prisma.food.count();
    console.log(`Foods in database: ${count}`);
    
    if (count === 0) {
      console.error('ERROR: No foods found after seeding!');
      process.exit(1);
    }
    
    console.log('✅ Database seeding verified');
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();

