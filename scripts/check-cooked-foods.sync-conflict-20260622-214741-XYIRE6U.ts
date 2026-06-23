import 'dotenv/config';
import { prisma } from '@/lib/db';

const expectedFoods = [
  'salmon, Atlantic, farmed, cooked, dry heat',
  'rice, brown, long-grain, cooked',
  'pasta, cooked, enriched, without added salt',
  'beef, ground, 85% lean meat / 15% fat, patty, cooked, broiled',
];

async function checkFoods() {
  // Search for salmon Atlantic cooked
  console.log('\n1. Searching for salmon, Atlantic, farmed, cooked, dry heat:');
  const salmon = await prisma.food.findMany({
    where: {
      name: { contains: 'salmon', mode: 'insensitive' },
      AND: [
        { name: { contains: 'Atlantic', mode: 'insensitive' } },
        { name: { contains: 'cooked', mode: 'insensitive' } },
      ]
    },
    take: 5,
    select: { name: true, source: true }
  });
  console.log(salmon.length > 0 ? `   ✅ Found: ${salmon.map(f => f.name).join(', ')}` : '   ❌ NOT FOUND');

  // Search for brown rice long-grain cooked
  console.log('\n2. Searching for rice, brown, long-grain, cooked:');
  const rice = await prisma.food.findMany({
    where: {
      name: { contains: 'rice', mode: 'insensitive' },
      AND: [
        { name: { contains: 'brown', mode: 'insensitive' } },
        { name: { contains: 'long-grain', mode: 'insensitive' } },
        { name: { contains: 'cooked', mode: 'insensitive' } },
      ]
    },
    take: 5,
    select: { name: true, source: true }
  });
  console.log(rice.length > 0 ? `   ✅ Found: ${rice.map(f => f.name).join(', ')}` : '   ❌ NOT FOUND');

  // Search for pasta cooked enriched
  console.log('\n3. Searching for pasta, cooked, enriched, without added salt:');
  const pasta = await prisma.food.findMany({
    where: {
      name: { contains: 'pasta', mode: 'insensitive' },
      AND: [
        { name: { contains: 'cooked', mode: 'insensitive' } },
        { name: { contains: 'enriched', mode: 'insensitive' } },
      ]
    },
    take: 5,
    select: { name: true, source: true }
  });
  console.log(pasta.length > 0 ? `   ✅ Found: ${pasta.map(f => f.name).join(', ')}` : '   ❌ NOT FOUND');

  // Search for beef ground 85% cooked
  console.log('\n4. Searching for beef, ground, 85% lean meat / 15% fat, patty, cooked, broiled:');
  const beef = await prisma.food.findMany({
    where: {
      name: { contains: 'beef', mode: 'insensitive' },
      AND: [
        { name: { contains: 'ground', mode: 'insensitive' } },
        { name: { contains: '85%', mode: 'insensitive' } },
        { name: { contains: 'cooked', mode: 'insensitive' } },
      ]
    },
    take: 5,
    select: { name: true, source: true }
  });
  console.log(beef.length > 0 ? `   ✅ Found: ${beef.map(f => f.name).join(', ')}` : '   ❌ NOT FOUND');
  
  await prisma.$disconnect();
}

checkFoods().catch(console.error);

