import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
    const res = await prisma.validatedMapping.findMany({
        where: {
            normalizedForm: { contains: 'cannellini' }
        }
    });
    console.log("Found", res.length, "entries:");
    console.log(JSON.stringify(res, null, 2));
}
main().finally(() => prisma.$disconnect());
