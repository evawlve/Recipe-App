import 'dotenv/config';
import { prisma } from '../src/lib/db';
async function main() {
    const fdc = await prisma.fdcFoodCache.findFirst({ where: { servings: { some: {} } } });
    console.log(JSON.stringify(fdc?.nutrients, null, 2));
    await prisma.$disconnect();
}
main();
