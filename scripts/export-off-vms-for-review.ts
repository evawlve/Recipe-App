import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';

const prisma = new PrismaClient();

async function main() {
  const mappings = await prisma.validatedMapping.findMany({
    where: {
      foodId: { startsWith: 'off_' },
    },
    orderBy: { createdAt: 'desc' }
  });

  const numChunks = 4;
  const chunkSize = Math.ceil(mappings.length / numChunks);
  
  const logsDir = path.join(process.cwd(), 'logs');
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }

  // Optimize: fetch all relevant OFF Cache items up front
  console.log('Fetching OpenFoodFactsCache items...');
  const offIds = mappings.map(m => m.foodId);
  const cacheItems = await prisma.openFoodFactsCache.findMany({
    where: {
      id: { in: offIds }
    }
  });
  
  const cacheMap = new Map();
  for (const item of cacheItems) {
    cacheMap.set(item.id, item);
  }
  console.log(`Fetched ${cacheMap.size} cache items.`);

  for (let i = 0; i < numChunks; i++) {
    const chunkFile = path.join(logsDir, `off-review-chunk-${i + 1}.txt`);
    const chunkMappings = mappings.slice(i * chunkSize, (i + 1) * chunkSize);
    
    const stream = fs.createWriteStream(chunkFile, { encoding: 'utf8' });
    
    stream.write(`=== OFF ValidatedMapping Review Chunk ${i + 1} ===\n`);
    stream.write(`Total mappings in this chunk: ${chunkMappings.length}\n\n`);

    for (const mapping of chunkMappings) {
      const offProduct = cacheMap.get(mapping.foodId);

      const nutrients = offProduct?.nutrientsPer100g as any;
      let nutrientStr = 'No nutritional data available';
      if (nutrients) {
        nutrientStr = `${Math.round(nutrients.calories || 0)} kcal | ` +
                      `${Math.round(nutrients.protein || 0)}g P | ` +
                      `${Math.round(nutrients.carbs || 0)}g C | ` +
                      `${Math.round(nutrients.fat || 0)}g F`;
      }

      const block = 
        `=========================================\n` +
        `RAW INGREDIENT: ${mapping.rawIngredient}\n` +
        `NORMALIZED:     ${mapping.normalizedForm}\n` +
        `BRAND:          ${mapping.brandName}\n` +
        `TARGET:         ${offProduct?.name || 'NOT FOUND'} (Barcode: ${mapping.foodId.replace('off_', '')})\n` +
        `NUTRITION/100g: ${nutrientStr}\n` +
        `=========================================\n\n`;
      
      stream.write(block);
    }
    
    stream.end();
    console.log(`Generated ${chunkFile} with ${chunkMappings.length} entries.`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
