import { prisma } from '@/lib/db';
import fs from 'fs';
import path from 'path';

async function ensureDir(p: string): Promise<void> {
  await fs.promises.mkdir(p, { recursive: true });
}

function formatDateUTC(d = new Date()): string {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}${mm}${dd}`;
}

async function readCommonKeywords(): Promise<string[]> {
  const keywordsFile = path.join(process.cwd(), 'data', 'usda', 'keywords-common.txt');
  try {
    const txt = await fs.promises.readFile(keywordsFile, 'utf8');
    return txt
      .split(/[,\n]/g)
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.length > 0);
  } catch {
    return [];
  }
}

async function main(): Promise<void> {
  const today = new Date();
  const dateStr = formatDateUTC(today);
  const reportDir = path.join(process.cwd(), 'reports');
  const reportPath = path.join(reportDir, `db-audit-${dateStr}.md`);

  // Summary stats
  const totalFoods = await prisma.food.count();
  const totalUnits = await prisma.foodUnit.count();
  const totalBarcodes = await prisma.barcode.count();

  // Foods by source
  const foodsBySource = await prisma.food.groupBy({
    by: ['source'],
    _count: true,
    orderBy: { source: 'asc' },
  });

  // Foods by category (top 10)
  const foodsByCategory = await prisma.food.groupBy({
    by: ['categoryId'],
    _count: true,
    where: { categoryId: { not: null } },
  });

  // Sort and take top 10
  const topCategories = foodsByCategory
    .sort((a, b) => (b._count || 0) - (a._count || 0))
    .slice(0, 10);

  // FoodUnits by label (top 15)
  const unitsRaw = await prisma.foodUnit.findMany({ select: { label: true } });
  const labelCounts = new Map<string, number>();
  for (const u of unitsRaw) {
    const key = (u.label || '').trim().toLowerCase();
    if (!key) continue;
    labelCounts.set(key, (labelCounts.get(key) || 0) + 1);
  }
  const topUnitLabels = Array.from(labelCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15);

  // Missing everyday items (by keywords not present in Food or FoodAlias)
  const keywords = await readCommonKeywords();
  const missing: string[] = [];
  const present: string[] = [];
  for (const kw of keywords) {
    const foundFood = await prisma.food.count({
      where: {
        OR: [
          { name: { contains: kw, mode: 'insensitive' } },
          { brand: { contains: kw, mode: 'insensitive' } },
          { aliases: { some: { alias: { contains: kw, mode: 'insensitive' } } } },
        ],
      },
    });
    if (foundFood > 0) present.push(kw); else missing.push(kw);
  }

  // Compose markdown report
  const lines: string[] = [];
  lines.push(`# DB Coverage Audit — ${today.toISOString().slice(0, 10)}`);
  lines.push('');
  lines.push('## Summary');
  lines.push(`- Total Foods: ${totalFoods}`);
  lines.push(`- Total Units: ${totalUnits}`);
  lines.push(`- Total Barcodes: ${totalBarcodes}`);
  lines.push('');
  lines.push('## Foods by Source');
  for (const row of foodsBySource) {
    lines.push(`- ${row.source || 'unknown'}: ${row._count || 0}`);
  }
  lines.push('');
  lines.push('## Top Categories (by Food count)');
  for (const row of topCategories) {
    lines.push(`- categoryId=${row.categoryId}: ${row._count || 0}`);
  }
  lines.push('');
  lines.push('## Top FoodUnit Labels');
  for (const [label, count] of topUnitLabels) {
    lines.push(`- ${label}: ${count}`);
  }
  lines.push('');
  lines.push('## Common Missing Items');
  const topMissing = missing.slice(0, 20);
  if (topMissing.length === 0) lines.push('- (none)');
  else topMissing.forEach((kw, i) => lines.push(`${i + 1}. ${kw}`));

  await ensureDir(reportDir);
  await fs.promises.writeFile(reportPath, lines.join('\n'), 'utf8');

  // Console summary
  // eslint-disable-next-line no-console
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  // eslint-disable-next-line no-console
  console.log('DB Coverage Audit — Summary');
  // eslint-disable-next-line no-console
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  // eslint-disable-next-line no-console
  console.log(`Foods: ${totalFoods}, Units: ${totalUnits}, Barcodes: ${totalBarcodes}`);
  // eslint-disable-next-line no-console
  console.log('Foods by source:', foodsBySource.map(f => `${f.source}:${f._count || 0}`).join(', '));
  // eslint-disable-next-line no-console
  console.log('Top unit labels:', topUnitLabels.map(([l, c]) => `${l}:${c}`).join(', '));
  // eslint-disable-next-line no-console
  console.log('Top missing keywords:', topMissing.join(', '));
  // eslint-disable-next-line no-console
  console.log('Report written to:', path.relative(process.cwd(), reportPath));
}

main().then(() => prisma.$disconnect()).catch(async (err) => {
  // eslint-disable-next-line no-console
  console.error('Audit failed:', err);
  await prisma.$disconnect();
  process.exit(1);
});
