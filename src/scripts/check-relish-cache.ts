import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    const relish = await prisma.validatedMapping.findFirst({
        where: { normalizedForm: { contains: 'relish', mode: 'insensitive' } }
    });
    console.log("Relish mapping:", JSON.stringify(relish, null, 2));

    const pickle = await prisma.validatedMapping.findFirst({
        where: { normalizedForm: { contains: 'pickle', mode: 'insensitive' } }
    });
    console.log("Pickle mapping:", JSON.stringify(pickle, null, 2));

    await prisma.$disconnect();
}

main();
