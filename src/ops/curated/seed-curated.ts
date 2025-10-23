import fs from 'fs';
import path from 'path';
import { prisma } from '@/lib/db';
import { CuratedPackSchema } from './seed-schema';
import { logger } from '@/lib/logger';

function canonicalize(s: string) {
  return s.toLowerCase().replace(/\(.*?\)/g, '').replace(/[,.-]/g,' ').replace(/\s+/g,' ').trim();
}

export async function seedCuratedFromFile(filePath: string, { dryRun=false } = {}) {
  const abs = path.resolve(process.cwd(), filePath);
  const raw = JSON.parse(fs.readFileSync(abs,'utf-8'));
  const parsed = CuratedPackSchema.parse(raw);

  let created = 0, updated = 0, aliCreated = 0, unitCreated = 0;

  for (const it of parsed.items) {
    const name = it.name.trim();
    const exists = await prisma.food.findUnique({ where: { id: it.id } });

    if (!exists) {
      if (!dryRun) {
        try {
          await prisma.food.create({
            data: {
              id: it.id,
              name,
              brand: it.brand ?? null,
              categoryId: it.categoryId ?? null,
              source: 'template',
              verification: it.verification,
              densityGml: it.densityGml ?? null,
              kcal100: it.kcal100,
              protein100: it.protein100,
              carbs100: it.carbs100,
              fat100: it.fat100,
              fiber100: it.fiber100 ?? null,
              sugar100: it.sugar100 ?? null,
              popularity: it.popularity,
              units: it.units.length ? { create: it.units.map(u => ({ label: u.label, grams: u.grams })) } : undefined
            }
          });
          created++;
        } catch (error: any) {
          if (error.code === 'P2002' && error.meta?.target?.includes('name')) {
            // Unique constraint on name+brand failed, try to find and update existing
            const existing = await prisma.food.findFirst({ 
              where: { name, brand: it.brand ?? null } 
            });
            if (existing) {
              await prisma.food.update({
                where: { id: existing.id },
                data: {
                  id: it.id, // Update to our curated ID
                  categoryId: it.categoryId ?? null,
                  source: 'template',
                  verification: it.verification,
                  densityGml: it.densityGml ?? null,
                  kcal100: it.kcal100,
                  protein100: it.protein100,
                  carbs100: it.carbs100,
                  fat100: it.fat100,
                  fiber100: it.fiber100 ?? null,
                  sugar100: it.sugar100 ?? null,
                  popularity: it.popularity
                }
              });
              updated++;
            } else {
              throw error; // Re-throw if we can't handle it
            }
          } else {
            throw error; // Re-throw other errors
          }
        }
      } else {
        created++;
      }
    } else {
      // Light-touch update to keep curated truth
      if (!dryRun) {
        await prisma.food.update({
          where: { id: it.id },
          data: {
            name,
            brand: it.brand ?? null,
            categoryId: it.categoryId ?? null,
            verification: it.verification,
            densityGml: it.densityGml ?? null,
            kcal100: it.kcal100,
            protein100: it.protein100,
            carbs100: it.carbs100,
            fat100: it.fat100,
            fiber100: it.fiber100 ?? null,
            sugar100: it.sugar100 ?? null,
            popularity: it.popularity
          }
        });
        // Ensure at least listed units exist (idempotent-ish)
        for (const u of it.units) {
          const hit = await prisma.foodUnit.findFirst({ where: { foodId: it.id, label: u.label } });
          if (!hit) {
            await prisma.foodUnit.create({ data: { foodId: it.id, label: u.label, grams: u.grams } });
            unitCreated++;
          }
        }
      }
      updated++;
    }

    // Aliases
    for (const a of it.aliases) {
      const alias = canonicalize(a);
      if (!alias) continue;
      const have = await prisma.foodAlias.findFirst({ where: { foodId: it.id, alias } });
      if (!have && !dryRun) {
        await prisma.foodAlias.create({ data: { foodId: it.id, alias } });
        aliCreated++;
      }
    }
  }

  logger.info('curated_seed summary', { feature:'curated_seed', step:'summary', file:filePath, created, updated, unitCreated, aliCreated });
  return { created, updated, unitCreated, aliCreated };
}
