import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const PURGE_IDS = [
    'vm_1775257089686_6h3658fho',  // fried shallots -> raw Shallots (fried vs raw, big diff)
    'vm_1775272295698_ddrpjo5dw',  // pineapple in juice -> Pineapple Juice (chunks vs beverage)
    'vm_1775272324815_s3h9zk080',  // ground sirloin -> Beef Top Sirloin (ground vs steak)
    'vm_1775439154167_xn9gzprn9',  // dark cocoa -> Dark Cocoa Hazelnut Spread (compound product)
    'vm_1775542907109_f2egy7r3v',  // evaporated skim milk -> Evaporated Milk (different fat+density)
    'vm_1775611101643_tnp1i2xvr',  // garlic herb seasoning -> Steam'ables veg dish (compound dish pollution)
    'vm_1776638811871_537jf0ucr',  // tart apples -> Tart Apples & Salted Caramel (added caramel)
    'vm_1776641585930_ylqu4y6zr',  // sweetened cranberries -> raw cranberries (big calorie undercount)
    'vm_1776644317022_ghfai3f7i',  // fat free chocolate yogurt -> Chocolate Yogurt (fat modifier wrong)
    'vm_1776639786125_fqf7vppqw',  // lean Italian sausage -> Italian Sausage (fat modifier wrong)
    'vm_1775273201601_gyrg2cbee',  // uncooked rice -> Cooked Rice (~3x calorie difference)
    'vm_1776887131638_60jcqdygw',  // sweetened mango -> Mango (added sugar missing)
    'vm_1776887319089_56dusn0ra',  // chunks sweetened pineapple -> Pineapple (added sugar missing)
    'vm_1776887362426_ufx5oe8o8',  // sweetened apricots -> Apricots (added sugar missing)
    'vm_1776886679091_f8yu0dq8r',  // red sweetened raspberries -> raw raspberries
];

async function main() {
    const result = await prisma.validatedMapping.deleteMany({ where: { id: { in: PURGE_IDS } } });
    console.log(`✅ Purged: ${result.count} entries`);
    const remaining = await prisma.validatedMapping.count();
    console.log(`   ValidatedMapping remaining: ${remaining}`);
    await prisma.$disconnect();
}

main().catch(e => { console.error(e); prisma.$disconnect(); process.exit(1); });
