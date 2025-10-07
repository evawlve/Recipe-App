import { NextRequest, NextResponse } from 'next/server';

/**
 * Very small nutrition calculator stub.
 * Input: { items: [{ name: string, qty: number, unit: string }] }
 * Output: totals (calories, proteinG, carbsG, fatG)
 *
 * NOTE: This uses a tiny hardcoded table for demo purposes.
 * Replace with a real datasource later.
 */
const table = [
  { key: 'chicken breast', calories: 165, proteinG: 31, carbsG: 0, fatG: 3.6, basis: { qty: 100, unit: 'g' } },
  { key: 'egg', calories: 72, proteinG: 6.3, carbsG: 0.4, fatG: 4.8, basis: { qty: 1, unit: 'unit' } },
  { key: 'rolled oats', calories: 389, proteinG: 16.9, carbsG: 66.3, fatG: 6.9, basis: { qty: 100, unit: 'g' } },
  { key: 'banana', calories: 105, proteinG: 1.3, carbsG: 27, fatG: 0.4, basis: { qty: 1, unit: 'unit' } },
];

function findRow(name: string) {
  const n = name.toLowerCase().trim();
  return table.find(r => n.includes(r.key));
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const items = Array.isArray(body?.items) ? body.items : [];

  const totals = items.reduce((acc: { calories: number; proteinG: number; carbsG: number; fatG: number }, it: any) => {
    const row = findRow(String(it.name || ''));
    if (!row) return acc;
    const factor = it.unit === row.basis.unit
      ? Number(it.qty) / row.basis.qty
      : 0; // simplistic; add conversions later

    acc.calories += row.calories * factor;
    acc.proteinG += row.proteinG * factor;
    acc.carbsG += row.carbsG * factor;
    acc.fatG += row.fatG * factor;
    return acc;
  }, { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 });

  return NextResponse.json({
    totals: {
      calories: Math.round(totals.calories),
      proteinG: Number(totals.proteinG.toFixed(1)),
      carbsG: Number(totals.carbsG.toFixed(1)),
      fatG: Number(totals.fatG.toFixed(1)),
    }
  });
}
