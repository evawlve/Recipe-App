import { prisma } from '../src/lib/db';

async function clear() {
  const words = ['corn', 'sweet corn', 'canned corn', 'kernel corn', 'nutmeg', 'cinnamon', 'clove', 'cloves', 'lasagna', 'lasagna noodles'];
  console.log('Deleting mappings for:', words);
  const m = await prisma.validatedMapping.deleteMany({
    where: { normalizedForm: { in: words } }
  });
  console.log('Deleted ValidatedMapping:', m.count);
  
  // also delete from learned synonym to ensure lasagna isn't rewritten magically
  const s = await prisma.learnedSynonym.deleteMany({
    where: { OR: [{ sourceTerm: { in: words } }, { targetTerm: { in: words } }] }
  });
  console.log('Deleted learned synonym:', s.count);

  const nm = await prisma.aiNormalizeCache.deleteMany({
     where: { normalizedName: { in: words }}
  });
  console.log('Deleted ai normalize cache:', nm.count);

}

clear().catch(console.error).finally(() => prisma.$disconnect());
