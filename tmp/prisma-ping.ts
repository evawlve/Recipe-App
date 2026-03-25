import { prisma } from '../src/lib/db';

async function main() {
    console.log('START: connecting...');
    console.log('Using URL:', process.env.DIRECT_URL ? 'DIRECT_URL (direct)' : 'DATABASE_URL (pooler)');
    try {
        const result = await prisma.$queryRawUnsafe('SELECT 1 as val');
        console.log('QUERY OK:', JSON.stringify(result));
    } catch (e: any) {
        console.error('QUERY ERR:', e.message);
        process.exit(1);
    } finally {
        console.log('Disconnecting...');
        await prisma.$disconnect();
        console.log('Done.');
        process.exit(0);
    }
}

main();
