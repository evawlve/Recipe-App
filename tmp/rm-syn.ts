import { PrismaClient } from '@prisma/client'; 
const prisma = new PrismaClient(); 
async function run() {
    const res = await prisma.learnedSynonym.deleteMany({ where: { sourceTerm: 'sour cream' } });
    console.log('Deleted rows:', res.count);
    await prisma.$disconnect();
}
run();
