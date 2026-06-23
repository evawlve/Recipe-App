import { prisma } from '../src/lib/db';

async function main() {
  const rs = await prisma.recipe.findMany({
    where: {
      ingredients: {
        some: {
          foodMaps: {
            none: {}
          }
        }
      }
    },
    select: {
      id: true,
      title: true,
      ingredients: {
        where: {
          foodMaps: {
            none: {}
          }
        },
        select: {
          id: true,
          name: true,
          qty: true,
          unit: true
        }
      }
    }
  });

  console.log(JSON.stringify(rs, null, 2));
}

main().finally(() => prisma.$disconnect());
