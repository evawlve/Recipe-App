import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';

const prisma = new PrismaClient();

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const MODEL = process.env.CHEAP_AI_MODEL_PRIMARY || "mistralai/mistral-nemo";

async function evaluateBatch(batch: any[], attempt = 1): Promise<string[]> {
    const prompt = `You are an expert food data reviewer. 
Review these ingredient mappings. A mapping is formatted as: ID: [Raw Ingredient] -> [Mapped Brand] [Mapped Food Name]
Identify ANY mappings that are blatantly incorrect (semantic inversions, completely unrelated foods, extreme mismatches).
It is OK if the raw ingredient is generic and it maps to a branded version of that generic item.
Return ONLY a valid JSON array of the IDs of the incorrect mappings. Return [] if all are fine. Do NOT return markdown formatting, just the raw JSON array.

Mappings:
${batch.map(m => `${m.id}: [${m.rawIngredient}] -> [${m.brandName || ''}] ${m.foodName}`).join('\n')}`;

    try {
        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                model: MODEL,
                messages: [{ role: "user", content: prompt }]
            })
        });

        if (!response.ok) {
            console.error("OpenRouter error:", response.status);
            return [];
        }

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content?.trim();
        
        if (!content) return [];
        
        const match = content.match(/\[.*\]/s);
        if (match) {
            const arr = JSON.parse(match[0]);
            return arr.map(String);
        }
        return [];
    } catch (err) {
        if (attempt < 3) return evaluateBatch(batch, attempt + 1);
        console.error("Evaluation error:", err);
        return [];
    }
}

async function processConcurrent(batches: any[][], concurrency: number) {
    const badMappings: any[] = [];
    let completed = 0;
    
    const workers = [];
    let currentIndex = 0;
    
    async function worker() {
        while (currentIndex < batches.length) {
            const batchIndex = currentIndex++;
            const batch = batches[batchIndex];
            const flaggedIds = await evaluateBatch(batch);
            completed++;
            if (completed % 10 === 0 || flaggedIds.length > 0) {
                console.log(`Progress: ${completed}/${batches.length} batches...`);
            }
            if (flaggedIds && flaggedIds.length > 0) {
                for (const id of flaggedIds) {
                    const m = batch.find((x: any) => x.id === id);
                    if (m) {
                        badMappings.push(m);
                        console.log(`[FLAGGED] [${m.rawIngredient}] -> [${m.brandName}] ${m.foodName}`);
                    }
                }
            }
        }
    }

    for (let i = 0; i < concurrency; i++) {
        workers.push(worker());
    }
    
    await Promise.all(workers);
    return badMappings;
}

async function main() {
  const mappings = await prisma.validatedMapping.findMany({
    where: {
      foodId: {
        startsWith: 'off_',
      },
    },
    select: { id: true, rawIngredient: true, foodName: true, brandName: true }
  });

  console.log(`Found ${mappings.length} OFF mappings. Sending to AI for review...`);
  
  const BATCH_SIZE = 50;
  const batches = [];
  for (let i = 0; i < mappings.length; i += BATCH_SIZE) {
      batches.push(mappings.slice(i, i + BATCH_SIZE));
  }
  
  const badMappings = await processConcurrent(batches, 10);
  
  console.log(`\n=== AI Verification Complete ===`);
  console.log(`Total flagged: ${badMappings.length}`);
  
  if (!fs.existsSync('logs')) fs.mkdirSync('logs');
  fs.writeFileSync('logs/flagged-off-vms.json', JSON.stringify(badMappings, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
