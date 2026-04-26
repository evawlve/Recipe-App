import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const mappings = await prisma.validatedMapping.findMany({
    where: {
      foodId: {
        startsWith: 'off_',
      },
    },
    take: 50,
  });

  console.log(`Found ${mappings.length} OFF mappings.`);
  let allValid = true;
  for (const mapping of mappings) {
    console.log(`[${mapping.normalizedForm}] -> ${mapping.foodId} (Brand: ${mapping.brandName})`);
    
    // Check if normalizedForm includes brandName
    if (mapping.brandName) {
      if (!mapping.normalizedForm.includes(mapping.brandName.toLowerCase())) {
        console.warn(`WARNING: normalizedForm '${mapping.normalizedForm}' does not include brandName '${mapping.brandName}'`);
        allValid = false;
      }
    }
    
    // Check if foodId format is strictly off_<barcode>
    if (!/^off_\d+$/.test(mapping.foodId)) {
        console.warn(`WARNING: foodId '${mapping.foodId}' does not match pattern off_<barcode>`);
        allValid = false;
    }
  }
  
  if (allValid && mappings.length > 0) {
      console.log('\nSUCCESS: All sampled OFF mappings look correct. normalizedForm includes brandName and foodId matches expected pattern.');
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
