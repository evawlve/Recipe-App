import { prisma } from '../src/lib/db';

async function main() {
  const count = await prisma.food.count();
  console.log(`Foods in database: ${count}`);
  
  if (count === 0) {
    console.error('ERROR: No foods found after seeding!');
    process.exit(1);
  }
  
  console.log('✅ Database seeding verified');
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('Error:', err);
  await prisma.$disconnect();
  process.exit(1);
});

