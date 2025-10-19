import React, { useState } from 'react';
import ConfidenceBadge from './ConfidenceBadge';
import { Badge } from '@/components/ui/badge';

type ServingOption = { label: string; grams: number };

export function IngredientMappingCard({
  ingredientName,
  parsed,               // from parseIngredientLine (if available)
  candidate,            // { id, name, brand, confidence, servingOptions, densityGml, ... }
  onMap,                // (opts: { foodId, servingGrams, useOnce, confidence }) => void
  gramsResolved,        // number | null (result of resolveGramsAdapter)
  usedFallbackServing,  // boolean (you can pass true when adapter fell back to first serving)
  isMapped = false,     // whether this ingredient is already mapped
}: {
  ingredientName: string;
  parsed?: { qty:number; multiplier:number; unit?:string|null; rawUnit?:string|null; name:string };
  candidate: { 
    id:string; 
    name:string; 
    brand?:string|null; 
    confidence:number; 
    servingOptions: ServingOption[];
    kcal100: number;
    protein100: number;
    carbs100: number;
    fat100: number;
    fiber100?: number | null;
    sugar100?: number | null;
    impact?: {
      perServing: any;
      deltas: any;
      nextScore: number;
      deltaScore: number;
      assumedServingLabel: string;
    };
  };
  onMap: (opts: { foodId:string; servingGrams:number; useOnce:boolean; confidence:number }) => void;
  gramsResolved: number | null;
  usedFallbackServing?: boolean;
  isMapped?: boolean;
}) {
  const [selected, setSelected] = useState<ServingOption | null>(null);
  const [manualGrams, setManualGrams] = useState<string>('');
  const [showEnterGrams, setShowEnterGrams] = useState(false);
  const [useOnce, setUseOnce] = useState(candidate.confidence < 0.5);

  const servingOptions = candidate.servingOptions.slice(0, 8); // keep it light
  const effectiveGrams = selected?.grams ?? (gramsResolved ?? null);

  // Derived nutrition for the effective serving
  const perServing = (() => {
    const g = effectiveGrams ?? (manualGrams ? parseFloat(manualGrams) : null);
    if (!g || Number.isNaN(g)) return null;
    const kcal = Math.round(candidate.kcal100 * g / 100);
    const P = candidate.protein100 * g / 100;
    const C = candidate.carbs100 * g / 100;
    const F = candidate.fat100 * g / 100;
    const Fi = candidate.fiber100 != null ? candidate.fiber100 * g / 100 : null;
    const Su = candidate.sugar100 != null ? candidate.sugar100 * g / 100 : null;
    return { g, kcal, P, C, F, Fi, Su };
  })();

  const proteinDensity = (() => {
    const kcal100 = candidate.kcal100 || 0;
    const protein100 = candidate.protein100 || 0;
    if (!kcal100) return 0;
    return (protein100 / kcal100) * 100;
  })();

  const flags = (() => {
    const highProtein = proteinDensity >= 10;
    const highFiber = perServing?.Fi != null ? perServing.Fi >= 3 : false;
    const highSugar = perServing?.Su != null ? perServing.Su >= 8 : false;
    const energyDense = ((candidate.kcal100 as any as number) || 0) >= 300;
    return { highProtein, highFiber, highSugar, energyDense };
  })();

  const handleCardClick = () => {
    if (isMapped) return; // Don't allow clicking if already mapped
    
    const grams = effectiveGrams ?? parseFloat(manualGrams);
    if (!grams || Number.isNaN(grams)) return;
    onMap({ foodId: candidate.id, servingGrams: grams, useOnce, confidence: candidate.confidence });
  };

  return (
    <div 
      className={`rounded-xl border p-3 space-y-2 transition-all duration-200 ${
        isMapped 
          ? 'bg-green-50 border-green-200 cursor-default dark:bg-green-900/20 dark:border-green-700' 
          : 'cursor-pointer hover:shadow-md hover:border-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 dark:border-gray-700 active:scale-[0.98]'
      }`}
      onClick={handleCardClick}
    >
      <div className="flex items-center justify-between">
        <div className="font-medium">{candidate.name}{candidate.brand ? ` — ${candidate.brand}` : ''}</div>
        <div className="flex items-center gap-2">
          <ConfidenceBadge value={candidate.confidence} />
          {isMapped && (
            <div className="text-green-600 dark:text-green-400 text-sm font-medium">✓ Mapped</div>
          )}
        </div>
      </div>

      {/* Prominent per-serving summary when grams known */}
      {perServing && (
        <div
          className="text-sm text-gray-900 dark:text-gray-100 flex items-center justify-between"
          title={`Per 100 g: ${(candidate.kcal100 as any as number)} kcal · ${(candidate.protein100 as any as number)}/${(candidate.carbs100 as any as number)}/${(candidate.fat100 as any as number)} g (P/C/F)`}
        >
          <div className="font-medium">
            {perServing.kcal} kcal · {Math.round(perServing.P)} P / {Math.round(perServing.C)} C / {Math.round(perServing.F)} F
          </div>
          <div className="flex flex-wrap gap-1">
            {flags.highProtein && <Badge variant="secondary" className="text-xs">High protein</Badge>}
            {flags.highFiber && <Badge variant="secondary" className="text-xs">High fiber</Badge>}
            {flags.highSugar && <Badge variant="secondary" className="text-xs">High sugar</Badge>}
            {flags.energyDense && <Badge variant="secondary" className="text-xs">Energy dense</Badge>}
          </div>
        </div>
      )}

      {/* Secondary small metrics */}
      {perServing && (
        <div className="text-xs text-muted-foreground">
          Protein dens. {proteinDensity.toFixed(1)} g/100 kcal · Fiber {perServing.Fi != null ? perServing.Fi.toFixed(1) : '—'} g · Sugar {perServing.Su != null ? perServing.Su.toFixed(1) : '—'} g
        </div>
      )}

      {/* Impact preview */}
      {candidate.impact && (
        <div className="text-xs text-gray-700 flex flex-wrap gap-2">
          <span>Δ {Math.round(candidate.impact.deltas.calories)} kcal</span>
          <span>· {Math.round(candidate.impact.deltas.protein)} P</span>
          <span>· {Math.round(candidate.impact.deltas.carbs)} C</span>
          <span>· {Math.round(candidate.impact.deltas.fat)} F</span>
          <span className="ml-2">
            Score → <b>{candidate.impact.nextScore}</b> ({candidate.impact.deltaScore >= 0 ? '+' : ''}{candidate.impact.deltaScore})
          </span>
        </div>
      )}

      {usedFallbackServing && (
        <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 px-2 py-1 rounded">
          Assumed <b>{servingOptions[0]?.label ?? 'primary serving'}</b> for "{ingredientName}". Change if needed.
        </div>
      )}

      {!isMapped && (
        <>
          {effectiveGrams != null ? (
            <div className="text-sm text-gray-700">Using <span className="font-medium">{Math.round(effectiveGrams)} g</span> for this ingredient.</div>
          ) : (
            <div className="flex flex-wrap gap-2 items-center">
              <span className="text-xs text-gray-600">We couldn't infer grams — pick one:</span>
              <div className="relative">
                <select
                  className="text-sm border rounded px-2 py-1"
                  defaultValue=""
                  onChange={(e) => {
                    e.stopPropagation();
                    const o = servingOptions.find(s => s.label === e.target.value) || null;
                    setSelected(o);
                  }}
                >
                  <option value="" disabled>Pick serving</option>
                  {servingOptions.map(s => <option key={s.label} value={s.label}>{s.label}</option>)}
                </select>
              </div>
              <button 
                className="text-sm border rounded px-2 py-1"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowEnterGrams(v => !v);
                }}
              >
                Enter grams
              </button>
            </div>
          )}

          {showEnterGrams && (
            <div className="flex items-center gap-2">
              <input
                type="number"
                inputMode="decimal"
                className="border rounded px-2 py-1 w-28"
                placeholder="grams"
                value={manualGrams}
                onChange={e => setManualGrams(e.target.value)}
                onClick={e => e.stopPropagation()}
              />
              <span className="text-xs text-gray-500">We'll use this once unless you save a serving.</span>
            </div>
          )}

          <div className="flex items-center justify-between pt-1">
            <label className="flex items-center gap-2 text-sm">
              <input 
                type="checkbox" 
                checked={useOnce} 
                onChange={e => {
                  e.stopPropagation();
                  setUseOnce(e.target.checked);
                }} 
              />
              Use once (don't save mapping)
            </label>
            <div className="text-xs text-gray-500">
              Click card to map
            </div>
          </div>
        </>
      )}
    </div>
  );
}
