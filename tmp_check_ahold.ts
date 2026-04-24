import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
p.validatedMapping.findMany({where: {foodName: 'CHICKEN BROTH', brandName: 'AHOLD'}}).then(r => console.log(JSON.stringify(r.slice(0, 5), null, 2)));
