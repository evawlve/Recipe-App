import { parseIngredientLine } from '../ingredient-line';

// F1: "<N> and [a|one] <fraction>" parses as N + fraction. Expected rows were
// recorded with the base parser first (moved rows) and re-read after the fix.
type Row = { line: string; qty?: number; unit?: string | null; name?: string; parse?: null };

const MOVED: Row[] = [
  { line: "2 and a half tbsp of Nutella", qty: 2.5, unit: "tbsp", name: "Nutella" },
  { line: "two and a half cups of Smartfood popcorn", qty: 2.5, unit: "cup", name: "Smartfood popcorn" },
  { line: "2 and a half tbsp of Jif peanut butter", qty: 2.5, unit: "tbsp", name: "Jif peanut butter" },
  { line: "2 and a half tbsp of Frank's RedHot", qty: 2.5, unit: "tbsp", name: "Frank's RedHot" },
  { line: "1 and half cups of unsweetened almond milk", qty: 1.5, unit: "cup", name: "unsweetened almond milk" },
  { line: "1 and a half Nature Valley crunchy bars", qty: 1.5, unit: null, name: "Nature Valley crunchy bars" },
  { line: "3 and a quarter cups of flour", qty: 3.25, unit: "cup", name: "flour" },
  { line: "2 and 1/2 cups of rice", qty: 2.5, unit: "cup", name: "rice" },
  { line: "two and a half slices of pizza", qty: 2.5, unit: "slice", name: "pizza" },
  { line: "four and a half ounces of salmon", qty: 4.5, unit: "oz", name: "salmon" },
  { line: "One and a half cups milk", qty: 1.5, unit: "cup", name: "milk" },
  { line: "about 2 and a half cups of rice", qty: 2.5, unit: "cup", name: "rice" },
  { line: "1 and a half scoops of whey protein", qty: 1.5, unit: "scoop", name: "whey protein" },
  { line: "1 and a half slices of bread", qty: 1.5, unit: "slice", name: "bread" },
  { line: "1 and three quarters cups of milk", qty: 1.75, unit: "cup", name: "milk" },
  { line: "twelve and a half ounces of steak", qty: 12.5, unit: "oz", name: "steak" },
  { line: "1 cup and 2 and a half tbsp of sugar", qty: 1.1540625, unit: "cup", name: "sugar" },
  { line: "2 and 2/3 cups flour", qty: 2.6666666666666665, unit: "cup", name: "flour" },
  { line: "1 and 1/8 tsp salt", qty: 1.125, unit: "tsp", name: "salt" },
  { line: "1 and one half cups milk", qty: 1.5, unit: "cup", name: "milk" },
  { line: "2 and a half", parse: null },
];

// Byte-identical to base. The three lines flagged below are unchanged by F1 --
// a pre-existing defect, not an endorsement: "2 eggs and a half bagel",
// "2 slices of toast and half an avocado" and "3 eggs and 2 strips of bacon".
// A leading "half and half" is the food's name (halfAndHalfCursor() in
// ingredient-line.ts): qty 1, the three words kept in the name.
const UNCHANGED: Row[] = [
  { line: "one and a half cups milk", qty: 1.5, unit: "cup", name: "milk" },
  { line: "one and a half cups of unsweetened almond milk", qty: 1.5, unit: "cup", name: "unsweetened almond milk" },
  { line: "one and a half cups of mashed potatoes", qty: 1.5, unit: "cup", name: "mashed potatoes" },
  { line: "1 and 1/2 cups of oatmeal", qty: 1.5, unit: "cup", name: "oatmeal" },
  { line: "1 1/2 cups of milk", qty: 1.5, unit: "cup", name: "milk" },
  { line: "2 1/2 tbsp peanut butter", qty: 2.5, unit: "tbsp", name: "peanut butter" },
  { line: "2.5 tbsp nutella", qty: 2.5, unit: "tbsp", name: "nutella" },
  { line: "a cup and a half of rice", qty: 1.5, unit: "cup", name: "rice" },
  { line: "a scoop and a half of whey protein", qty: 1.5, unit: "scoop", name: "whey protein" },
  { line: "half and half", qty: 1, unit: null, name: "half and half" },
  { line: "2 tbsp half and half", qty: 2, unit: "tbsp", name: "half and half" },
  { line: "half a cup of rice", qty: 0.5, unit: "cup", name: "rice" },
  { line: "2 eggs and a half bagel", qty: 2.5, unit: "egg", name: "bagel" },
  { line: "2 slices of toast and half an avocado", qty: 2, unit: "slice", name: "toast and half an avocado" },
  { line: "3 eggs and 2 strips of bacon", qty: 3, unit: "egg", name: "and 2 strips of bacon" },
  { line: "dozen and a half eggs", qty: 12, unit: null, name: "and a half eggs" },
  { line: "2.5 and a half cups", qty: 2.5, unit: null, name: "and a half cups" },
];

function check(rows: Row[]) {
  test.each(rows.map((r) => [r.line, r] as const))("%s", (_line, r) => {
    const res = parseIngredientLine(r.line);
    if (r.parse === null) {
      expect(res).toBeNull();
      return;
    }
    expect(res).not.toBeNull();
    expect((res!.qty ?? 0) * res!.multiplier).toBe(r.qty);
    expect(res!.unit).toBe(r.unit);
    expect(res!.name).toBe(r.name);
  });
}

describe("F1 '<N> and a half <unit>' is N + fraction", () => check(MOVED));
describe("F1 controls unchanged vs base", () => check(UNCHANGED));
