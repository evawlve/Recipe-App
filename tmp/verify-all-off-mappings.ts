import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const mappings = await prisma.validatedMapping.findMany({
    where: {
      foodId: {
        startsWith: 'off_',
      },
    },
  });

  console.log(`Found ${mappings.length} OFF mappings to verify.`);
  
  let invalidFoodIdPattern = 0;
  let missingBrandInNorm = 0;
  let completelyMismatchBrand = 0;

  for (const mapping of mappings) {
    // Check if foodId format is strictly off_<barcode>
    if (!/^off_\d+$/.test(mapping.foodId)) {
        if (invalidFoodIdPattern < 10) {
            console.warn(`WARNING: foodId '${mapping.foodId}' does not match pattern off_<barcode>`);
        }
        invalidFoodIdPattern++;
    }
    
    if (mapping.brandName) {
      const brandWords = mapping.brandName.toLowerCase().split(/[\s\-&]+/);
      
      if (!mapping.normalizedForm.includes(mapping.brandName.toLowerCase())) {
        missingBrandInNorm++;
        
        // Stricter check: does it share ANY word?
        const hasAnyWord = brandWords.some(bw => bw.length > 2 && mapping.normalizedForm.includes(bw));
        if (!hasAnyWord) {
            completelyMismatchBrand++;
            if (completelyMismatchBrand <= 50) { // print only first 50 completely mismatched
               console.warn(`SEVERE: Brand '${mapping.brandName}' entirely missing in normalizedForm '${mapping.normalizedForm}' for '${mapping.rawIngredient}'`);
            }
        }
      }
    }
  }
  
  console.log(`\n=== Verification Summary ===`);
  console.log(`Total checked: ${mappings.length}`);
  console.log(`Invalid foodId pattern: ${invalidFoodIdPattern}`);
  console.log(`Strict Brand not in normalizedForm (often fine due to stemming): ${missingBrandInNorm}`);
  console.log(`Severe Brand Missing (no shared words > 2 chars): ${completelyMismatchBrand}`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
