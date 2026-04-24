import { prisma } from '../src/lib/db';

async function main() {
    const count = await prisma.validatedMapping.count();
    console.log('ValidatedMapping count:', count);
    await prisma.$disconnect();
}
main();
