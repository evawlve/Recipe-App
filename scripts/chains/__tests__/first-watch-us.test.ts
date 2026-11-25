import firstWatch from '../adapters/first-watch-us';

// A small synthetic page in the chain's shape (never a copy of the real one). Columns are deliberately in a DIFFERENT
// order from the real page's, so a position-based parse would read the wrong numbers.
const COLS = ['Protein (g)', 'Calories (cal)', 'Calories (cal)<br>from Fat', 'Fat (g)', 'Carbs (g)', 'Added Sugars (g)'];
const th = (c: string) => `<th class="data-heading-cell" scope="col"><span>${c}</span></th>`;
const row = (name: string, protein: number, kcal: number, fat: number, carbs: number, added = 0) =>
  `<tr class="nutrition-data-row"><th scope="row"><h3 class="nutrition-item-name"><a href="/menu/x">${name}</a></h3></th>` +
  [protein, kcal, 0, fat, carbs, added].map((n) => `<td><span class="nutrition-data-number">${n}</span></td>`).join('') +
  `</tr><tr class="allergens-row"><td>Milk</td></tr>`;
const table = (id: string, h2: string, rows: string[]) =>
  `<table class="nutrition-table nutrition-details-table"><caption id="${id}-caption">x</caption><thead><tr>` +
  `<th scope="col"><h2>${h2}</h2></th>${COLS.map(th).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>`;

const html = [
  table('seasonal_tampa_a', 'Seasonal Items', []),
  table('classic', 'The Classics', [
    row('Chickichanga &reg;', 50, 1150, 60, 100),
    row('French Toast', 20, 740, 30, 90),
    row('Hot Chocolate', 1, 250, 5, 23),
    row('Iced Coffee', 2, 100, 3, 14),
  ]),
  table('kids', 'Kid&rsquo;s Menu', [row('French Toast', 15, 590, 20, 80), row('Steel-Cut Oatmeal', 8, 300, 5, 55)]),
  table('sides', 'Sides', [row('Steel-Cut Oatmeal', 20, 995, 30, 150), row('Latte (Small)', 8, 120, 5, 12), row('Latte (Large)', 12, 200, 8, 20)]),
  table('iced_coffee_core', 'Iced Coffee', [row('Iced Coffee', 2, 100, 3, 14)]),
  table('boozy_core', 'Boozy', [row('Mimosa', 1, 260, 0, 38)]),
].join('');

describe('first-watch-us parse', () => {
  const { items, components } = firstWatch.parse({ nutrition: html });
  const byKey = new Map(items.map((i) => [i.key, i]));

  it('maps columns by header text, not position, and has no components', () => {
    expect(components).toEqual([]);
    const c = byKey.get('first-watch-chickichanga');
    expect(c?.name).toBe('Chickichanga');
    expect(c?.servingG).toBeNull();
    expect(c?.panel).toMatchObject({ kcal: 1150, proteinG: 50, fatG: 60, carbsG: 100, addedSugarG: 0 });
  });
  it('splits (Small)/(Large) into the key and the variant', () => {
    expect(byKey.get('first-watch-latte-small')?.variant).toBe('size=small');
    expect(byKey.get('first-watch-latte-large')?.name).toBe('Latte');
  });
  it('keys a differing row from the kids table <key>-kids with menu=kids, and keeps the regular one plain', () => {
    expect(byKey.get('first-watch-french-toast')?.panel.kcal).toBe(740);
    expect(byKey.get('first-watch-french-toast-kids')).toMatchObject({ variant: 'menu=kids', name: 'French Toast' });
    expect(byKey.get('first-watch-french-toast-kids')?.panel.kcal).toBe(590);
    expect(byKey.get('first-watch-steel-cut-oatmeal-kids')?.panel.kcal).toBe(300);
  });
  it('keeps one of identical rows repeated in a regional table', () => {
    expect(items.filter((i) => i.key === 'first-watch-iced-coffee')).toHaveLength(1);
  });
  it('leaves the SOURCE_ERRORS row out', () => {
    expect(byKey.has('first-watch-hot-chocolate')).toBe(false);
  });
  it('exempts rows in a table headed Boozy from the Atwater gate, and only those', () => {
    expect(byKey.get('first-watch-mimosa')?.atwaterExempt).toBe('alcohol');
    expect(byKey.get('first-watch-chickichanga')?.atwaterExempt).toBeUndefined();
  });
  it('stops on a differing duplicate that is not a kids row', () => {
    const bad = table('classic', 'The Classics', [row('Hash', 1, 100, 1, 1), row('Hash', 1, 110, 1, 1)]);
    expect(() => firstWatch.parse({ nutrition: bad })).toThrow(/appears twice with different rows/);
  });
});
