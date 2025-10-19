import { scoreV2, Goal } from './score-v2';
import { perServingFrom100, Per100 } from './perServing';

export type Totals = { calories:number; protein:number; carbs:number; fat:number; fiber?:number; sugar?:number };

export function computeImpactPreview({
  currentTotals,
  foodPer100,
  servingGrams,
  goal
}: { currentTotals: Totals; foodPer100: Per100; servingGrams: number; goal: Goal }) {
  const add = perServingFrom100(foodPer100, servingGrams);
  const next = {
    calories: (currentTotals.calories || 0) + add.calories,
    protein:  (currentTotals.protein  || 0) + add.protein,
    carbs:    (currentTotals.carbs    || 0) + add.carbs,
    fat:      (currentTotals.fat      || 0) + add.fat,
    fiber:    (currentTotals.fiber ?? 0) + add.fiber,
    sugar:    (currentTotals.sugar ?? 0) + add.sugar,
  };
  const prevScore = scoreV2(currentTotals, goal).value;
  const nextScore = scoreV2(next, goal).value;
  return { perServing: add, deltas: add, nextTotals: next, prevScore, nextScore, deltaScore: nextScore - prevScore };
}
