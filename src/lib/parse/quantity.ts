/**
 * Parse quantity tokens to extract numeric values and fractions
 * Handles integers, decimals, unicode fractions, word fractions, ranges, and fractions attached to numbers
 */

// Unicode fractions mapping
const UNICODE_FRACTIONS: Record<string, number> = {
  '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3,
  '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875
};

/**
 * Extract a number with optional attached unicode fraction (e.g., "2½" -> 2.5)
 */
function parseNumberWithFraction(token: string): { whole: number; fraction: number } | null {
  // Check if token contains a unicode fraction
  for (const [frac, value] of Object.entries(UNICODE_FRACTIONS)) {
    if (token.includes(frac)) {
      // Extract the number part (everything before the fraction)
      const numPart = token.replace(frac, '').trim();
      const whole = numPart ? parseFloat(numPart) : 0;
      if (!isNaN(whole)) {
        return { whole, fraction: value };
      }
    }
  }
  return null;
}

/**
 * Check if a token contains a range separator and split it
 */
function splitRangeToken(token: string): { first: string; separator: string; second: string } | null {
  // Check for hyphen, en-dash, or em-dash in the token
  const rangePattern = /^(.+?)([-–—])(.+)$/;
  const match = token.match(rangePattern);
  if (match) {
    return {
      first: match[1],
      separator: match[2],
      second: match[3]
    };
  }
  return null;
}

/**
 * Parse a range (e.g., "2-3", "2–3", "2 to 3") and return the average
 * Returns null if no range separator is found
 * Handles both separate tokens ("2", "-", "3") and combined tokens ("2-3")
 */
function parseRange(tokens: string[], startIdx: number): { qty: number; consumed: number } | null {
  if (startIdx >= tokens.length) return null;

  let firstNum: number | null = null;
  let secondNum: number | null = null;
  let i = startIdx;
  let consumed = 0;

  // Check if first token contains a range separator (e.g., "2-3")
  const firstToken = tokens[i];
  const rangeSplit = splitRangeToken(firstToken);

  if (rangeSplit) {
    // Token contains range separator - parse both parts
    const firstWithFraction = parseNumberWithFraction(rangeSplit.first);
    if (firstWithFraction) {
      firstNum = firstWithFraction.whole + firstWithFraction.fraction;
    } else {
      const num = parseFloat(rangeSplit.first);
      if (!isNaN(num)) {
        firstNum = num;
      } else {
        return null;
      }
    }

    const secondWithFraction = parseNumberWithFraction(rangeSplit.second);
    if (secondWithFraction) {
      secondNum = secondWithFraction.whole + secondWithFraction.fraction;
    } else {
      const num = parseFloat(rangeSplit.second);
      if (!isNaN(num)) {
        secondNum = num;
      } else {
        return null;
      }
    }

    // Return average of range
    if (firstNum !== null && secondNum !== null) {
      return { qty: (firstNum + secondNum) / 2, consumed: 1 };
    }
    return null;
  }

  // Try to parse first number (may have fraction attached)
  const firstWithFraction = parseNumberWithFraction(firstToken);

  if (firstWithFraction) {
    firstNum = firstWithFraction.whole + firstWithFraction.fraction;
    consumed = 1;
    i++;
  } else {
    const num = parseFloat(firstToken);
    if (!isNaN(num)) {
      firstNum = num;
      consumed = 1;
      i++;
    } else {
      return null;
    }
  }

  // Must have a range separator to be a range
  if (i >= tokens.length) return null;

  const separator = tokens[i];
  const isRangeSeparator =
    separator === '-' ||
    separator === '–' || // en-dash
    separator === '—' || // em-dash
    separator === 'to' ||
    separator === 'To';

  if (!isRangeSeparator) {
    // Not a range
    return null;
  }

  consumed++; // consume separator
  i++;

  // Parse second number (may have fraction attached)
  if (i >= tokens.length) {
    // Range separator but no second number - not a valid range
    return null;
  }

  const secondToken = tokens[i];
  const secondWithFraction = parseNumberWithFraction(secondToken);

  if (secondWithFraction) {
    secondNum = secondWithFraction.whole + secondWithFraction.fraction;
    consumed++;
  } else {
    const num = parseFloat(secondToken);
    if (!isNaN(num)) {
      secondNum = num;
      consumed++;
    } else {
      // Second number invalid - not a valid range
      return null;
    }
  }

  // Return average of range
  if (firstNum !== null && secondNum !== null) {
    return { qty: (firstNum + secondNum) / 2, consumed };
  }

  return null;
}

/**
 * A percentage or a leanness ratio is a MODIFIER, never a count.
 *
 * `parseFloat('93%')` is 93 and `'85/15'` reads as the fraction 85/15, so until
 * 2026-08-24 `2% milk` parsed as qty 2 -- every one of the 90 MappingEventLog
 * events for that line billed 500 g / 226 kcal, two label servings -- and
 * `93% lean ground turkey` as qty 93 (10,416 g). Neither is a count; the token
 * belongs to the food's name and stays there. Downstream that is already
 * handled: normalizeIngredientName() strips 50-100% unless `lean` follows, so
 * `100% whole wheat bread` still keys as `whole wheat bread`, while `2% milk`
 * keeps its fat-percent identity (the live FoodMapping keys `2% fairlife milk`,
 * `2% dairy milk pure` show that shape). A leanness ratio is two integers that
 * sum to 100 (85/15, 80/20, 93/7); a real fraction (`1/2`, `3/4`) never does.
 * Owner (mobile repo): sync-docs/reports/2026-08-24_the-leanness-default-fires-on-meats-the-corpus-never-labels.md §5.
 */
export function isPercentOrLeannessRatioToken(token: string): boolean {
  if (/^\d+(?:\.\d+)?%$/.test(token)) return true;
  const m = /^(\d{1,3})\/(\d{1,3})$/.exec(token);
  return !!m && Number(m[1]) + Number(m[2]) === 100;
}

/**
 * SPANISH NUMERALS AND FRACTION WORDS.
 *
 * ####################################################################
 * # HELD 2026-09-12 (Lane A S49). DO NOT SHIP THIS TABLE AS IT STANDS.
 * # It was gated by two independent arms and by an adversarial lens,
 * # and it is NET NEGATIVE on its own measured population. The list of
 * # refusals below is INCOMPLETE -- the collisions in "WHAT THE GATE
 * # FOUND" are live in this table right now. Read that block before
 * # reviving anything here. Owner (mobile repo):
 * # sync-docs/reports/2026-09-12_lane-a-s49-the-parser-seat-and-four-measured-refusals.md
 * ####################################################################
 *
 * Measured 2026-09-12 (Lane A S49): the 43-line Spanish corpus
 * (scripts/eval/spanish/spanish-corpus-2026-09-12.json) parsed ZERO of its
 * eight Spanish quantity expressions -- the only quantity line that parsed was
 * the control `100 g de pollo`, which is already English-shaped -- and a
 * missing numeral HALVES the bill rather than leaving a plausible default:
 * `dos huevos` billed 50 g / 74 kcal against ~100 g, `dos piezas de pan` 26 g
 * against ~52-60 g, `dos tamales de pollo` 57 g against ~114 g. Owner (mobile
 * repo): sync-docs/reports/2026-09-12_spanish-eval-corpus-baseline.md, the
 * "Spanish NUMERALS fall through" section.
 *
 * THIS IS A RETRIEVAL-CHANGING LIST, NOT A VOCABULARY. Every entry CONSUMES a
 * leading token that would otherwise stay in the food's name, so four tokens
 * are deliberately absent and each absence is measured, not cautious:
 *
 *  - `tres` (3). `tres leches` and `tres leches cake` are ENGLISH-corpus dish
 *    names carrying organic cached traffic -- 5 MappingEventLog events over 2
 *    distinct rawLines, `noCache` = false, first seen 2026-07-21. As a numeral
 *    it bills 3 of `leches`. Re-derive:
 *      SELECT lower("rawLine"), "noCache", count(*) FROM "MappingEventLog"
 *       WHERE lower("rawLine") ~ '(^|[[:space:]])tres([[:space:]]|$)'
 *       GROUP BY 1,2;
 *    What it needs is a PARSE-layer protected-phrase list: the mapping-layer
 *    PROTECTED_PRODUCT_PHRASES (mapping/normalization-rules.ts) runs
 *    downstream of this parse and cannot reach the quantity decision.
 *  - `siete` (7). An exact BRAND_SET entry (Siete Foods), measured with the
 *    shipped detector -- detectBrandInQuery('siete tortilla chips') returns
 *    isBranded with matchedBrand `siete`. It is a SINGLE-token brand, and
 *    matchWordNumberBrandTokens() in ingredient-line.ts guards only MULTI-token
 *    ones, so `siete tortilla chips` would parse as 7 tortillas of "chips" --
 *    the n-serv-35 / n-tot-05 shape that unit.ts's COUNT_NOUN header records.
 *  - `once` (11). A common English word, and it leads two lexicon brands
 *    (`once again`, `once upon a farm`). Both are multi-token, so the guard
 *    above COULD cover them -- but only through QUANTITY_WORD_NUMBERS in
 *    ingredient-line.ts, which this change deliberately does not touch.
 *  - `un` / `una` / `uno` (1). Numerically inert -- a bare line already
 *    defaults to qty 1 -- but it consumes the leading token and so moves the
 *    retrieval term. On the corpus it fires on exactly the two lines that land
 *    correctly BY LUCK rather than by parsing (`un vaso de leche` 250 g and
 *    `una cucharada de aceite de oliva` 15 g both take the record's own label
 *    serving), so it can only move them off a right answer.
 *
 * THE OTHER TWO CONSUMERS OF parseQuantityTokens() ARE STRUCTURALLY EMPTY, and
 * both were checked rather than assumed: declaredVolumeUnitGrams() in
 * mapping/build-fatsecret-result.ts reads FatSecretServing.description, where
 * ZERO of 55,058 rows lead with any token added here (measured 2026-09-12);
 * and leadingLabelFraction() in mapping/count-label.ts is gated by
 * LABEL_FRACTION_RE, which is digit-only and can never match a word.
 *
 * WHAT THE GATE FOUND, and why this table is HELD. Three arms on
 * 2026-09-12: a hand-built `--cross-snapshot` winner-diff, a two-tree
 * re-probe of the 43-line Spanish corpus at 3 draws per side, and an
 * adversarial lens over the corpora the first two do not cover.
 *
 * (1) ON THE SPANISH CORPUS the net is not shippable. Five rows move:
 *     `dos tamales de pollo` is a clean fix (same record, same tier,
 *     57 -> 114 g); `dos huevos` improves but CHANGES RECORD (fs_3092
 *     "Egg" 50 g -> off_2100002978128 "Huevos" 120 g); `media manzana`
 *     and `medio aguacate` DEGRADE the serving tier onto a fabricated
 *     `flat_100g_default` floor; and `dos piezas de pan` turns a silent
 *     `no_winner_all_filtered` into a confident `off_0866405295867`
 *     "Pan de pascua" -- a Chilean Christmas cake -- at 116 g / 460 kcal.
 *     THE MECHANISM: `parsed.name` IS the retrieval term, so consuming a
 *     leading token shortens the search string and changes which record
 *     wins and which serving tier resolves. 4 of the 5 changed record.
 *     Consuming a numeral is not a portion-only edit, and every prior
 *     brief on this lever assumed it was.
 *
 * (2) THE REFUSAL LIST ABOVE IS INCOMPLETE, and `dos` itself belongs on
 *     it. `dos equis` is a MULTI-token BRAND_SET entry, so
 *     `parseIngredientLine('dos equis')` reads qty 2 / name "equis"
 *     while `detectBrandInQuery` still returns brand `dos equis`. The
 *     `siete` reasoning above INVERTS here and is wrong as stated:
 *     `matchWordNumberBrandTokens()` guards multi-token brands only
 *     through QUANTITY_WORD_NUMBERS in ingredient-line.ts, which this
 *     change does not widen -- so a multi-token brand led by a Spanish
 *     numeral is NOT guarded either. That is the `five guys little
 *     cheeseburger` defect, one language over.
 *
 * (3) FOUR MORE SHIPPED TOKENS CARRY THE `tres leches` SHAPE, measured
 *     against OffFood / FatSecretFood rather than MappingEventLog (the
 *     traffic test cannot see a food nobody has typed yet):
 *       `cuatro leches`   -> qty 4 of "leches"      (an OFF dish name)
 *       `doce de leite`   -> qty 12 of "de leite"   (26 OFF rows, every
 *                            one Portuguese sweet; zero mean *twelve*)
 *       `cinco jotas ham` -> qty 5 of "jotas ham"   (a Spanish jamon brand)
 *       `dos de saumon`   -> qty 2 of "de saumon"   (French: `dos` = loin)
 *       `media crema`     -> qty 0.5 of "crema"     (Nestle table cream,
 *                            a staple in exactly the household this is for)
 *       `media noche`     -> qty 0.5 of "noche"     (a Cuban sandwich)
 *
 * (4) THIS TABLE WIDENS A DIVERGENCE THE CODEBASE CALLS "THE BUG, NOT
 *     THE DESIGN". On master WORD_NUMBERS and QUANTITY_WORD_NUMBERS are
 *     both 14 and identical, divergence 0; with this table it is 23 vs
 *     14, divergence 9. `brand-led-product-name.test.ts` P2 pins only
 *     QUANTITY_WORD_NUMBERS is-subset-of parseQuantityTokens, so it is
 *     blind to exactly this direction. (The QUANTITY_WORD_NUMBERS header
 *     names a sync test, `word-number-brand.test.ts`, that has NEVER
 *     existed on any branch -- but P2 does carry the one-directional
 *     assertion, so the coverage is thin, not absent.)
 *
 * (5) `docena` is near-inert as written: `hasArticle` accepts only
 *     `a`/`an` before `dozen`/`couple`, so the idiomatic `una docena de
 *     huevos` parses as qty 1 and only a bare-leading `docena ...` fires.
 *     Shipping `docena` while refusing `una` is self-defeating. Related
 *     and unowned: the Spanish partitive `de` is never consumed --
 *     `consumePartitiveOf()` knows only `of` -- so every `<numeral> de
 *     <food>` line leaves a leading `de` in the retrieval term.
 *
 * THE REVIVAL PATH, measured rather than guessed: bare `pan` resolves
 * correctly on its own (off_04516246 "Pan", 40 g / 150 kcal,
 * `bare_label_serving`), so `pieza(s)` -> `piece` and `rebanada(s)` ->
 * `slice` -- aliases onto count units that ALREADY exist in the English
 * table -- would bill 2 x 40 g of real bread instead of a fruitcake.
 * `media`/`medio` should probably come out: both their lines land on the
 * fabricated floor. And QUANTITY_WORD_NUMBERS must widen in the same PR,
 * with a BOTH-directions intersection test.
 *
 * Container words (`taza`, `vaso`, `cucharada`, `pieza`, `rebanada`) are
 * deliberately NOT added as units: on the same corpus `una taza de arroz`
 * already lands about a cup, and its whole 2.6x over-bill is that the record is
 * DRY rice at 352 kcal/100 g -- parsing the unit bills MORE dry rice and makes
 * the line worse.
 */
export const SPANISH_WORD_NUMBERS: Record<string, number> = {
  dos: 2, cuatro: 4, cinco: 5, seis: 6, ocho: 8, nueve: 9, diez: 10,
  doce: 12, docena: 12,
};

/**
 * `media` / `medio` are the Spanish `half`, and they are gendered, so both
 * spellings are needed (`media manzana`, `medio aguacate`). Mirrored into
 * normalizeUnitToken()'s multiplier table in unit.ts for the same reason
 * `half` appears in both: the two tables answer different questions about the
 * same word and a word that is in one and not the other reads as a unit in one
 * position and a quantity in the other.
 *
 * `medio` also fires UPSTREAM of a translation defect the same corpus found --
 * the normalizer renders `medio aguacate` as `medium avocado`, reading *half*
 * as *medium* -- so consuming it here MAY also close that line. That is a
 * prediction, not a measurement; see this change's report.
 */
export const SPANISH_WORD_FRACTIONS: Record<string, number> = {
  media: 0.5, medio: 0.5,
};

export function parseQuantityTokens(tokens: string[]): { qty: number; consumed: number } | null {
  if (tokens.length === 0) return null;
  // A leading `2%` / `93%` / `85/15` is a modifier on the food, not a quantity (see above).
  if (isPercentOrLeannessRatioToken(tokens[0])) return null;

  let qty = 0;
  let consumed = 0;
  let i = 0;

  // First, try to parse as a range (handles "2-3", "1½-2", etc.)
  const rangeResult = parseRange(tokens, i);
  if (rangeResult) {
    return rangeResult;
  }

  // Handle unicode fractions as standalone tokens
  if (UNICODE_FRACTIONS[tokens[0]]) {
    return { qty: UNICODE_FRACTIONS[tokens[0]], consumed: 1 };
  }

  // Handle word fractions
  const wordFractions: Record<string, number> = {
    'half': 0.5, 'quarter': 0.25, 'third': 1 / 3,
    ...SPANISH_WORD_FRACTIONS
  };

  if (wordFractions[tokens[0]]) {
    return { qty: wordFractions[tokens[0]], consumed: 1 };
  }

  // Handle "one and a half" pattern
  if (tokens.length >= 4 &&
    tokens[0] === 'one' &&
    tokens[1] === 'and' &&
    tokens[2] === 'a' &&
    tokens[3] === 'half') {
    return { qty: 1.5, consumed: 4 };
  }

  // Handle "1 and 1/2" pattern
  if (tokens.length >= 3 &&
    tokens[0] === '1' &&
    tokens[1] === 'and' &&
    tokens[2] === '1/2') {
    return { qty: 1.5, consumed: 3 };
  }

  // Handle word-number quantities: "two eggs" -> 2, "a dozen eggs" -> 12,
  // "a couple of eggs" -> 2. Deliberately placed AFTER the "one and a half" /
  // "1 and 1/2" blocks above so those still match the literal "one"/"a" tokens.
  // "a"/"an" is NOT a number on its own (bare "a bagel" already defaults to
  // qty 1); it only counts here as the article in "a dozen"/"a couple".
  const WORD_NUMBERS: Record<string, number> = {
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
    nine: 9, ten: 10, eleven: 11, twelve: 12, dozen: 12, couple: 2,
    ...SPANISH_WORD_NUMBERS,
  };
  const article = tokens[0].toLowerCase();
  const hasArticle =
    (article === 'a' || article === 'an') &&
    tokens.length >= 2 &&
    (tokens[1].toLowerCase() === 'dozen' || tokens[1].toLowerCase() === 'couple');
  const numIdx = hasArticle ? 1 : 0;
  const word = tokens[numIdx].toLowerCase();
  if (WORD_NUMBERS[word] !== undefined) {
    let wordConsumed = numIdx + 1;
    // Consume an optional partitive "of": "a couple of eggs", "couple of eggs".
    if (tokens[wordConsumed]?.toLowerCase() === 'of') wordConsumed += 1;
    return { qty: WORD_NUMBERS[word], consumed: wordConsumed };
  }

  // Handle "number fraction" pattern (e.g., "1 1/2", "4 1/2")
  if (tokens.length >= 2) {
    const firstNum = parseFloat(tokens[0]);
    if (!isNaN(firstNum)) {
      // Check if second token is fraction like "1/2"
      if (tokens[1].includes('/')) {
        const parts = tokens[1].split('/');
        if (parts.length === 2) {
          const n = parseFloat(parts[0]);
          const d = parseFloat(parts[1]);
          if (!isNaN(n) && !isNaN(d) && d !== 0) {
            return { qty: firstNum + (n / d), consumed: 2 };
          }
        }
      }
    }
  }

  // Handle number with attached unicode fraction (e.g., "2½", "1¼")
  const numberWithFraction = parseNumberWithFraction(tokens[0]);
  if (numberWithFraction) {
    return { qty: numberWithFraction.whole + numberWithFraction.fraction, consumed: 1 };
  }

  // Handle "number fraction" pattern (e.g., "2 ½", "1 ¼") - space between number and fraction
  if (tokens.length >= 2) {
    const firstNum = parseFloat(tokens[0]);
    if (!isNaN(firstNum) && UNICODE_FRACTIONS[tokens[1]]) {
      return { qty: firstNum + UNICODE_FRACTIONS[tokens[1]], consumed: 2 };
    }
  }

  // Handle simple fractions like "1/2"
  if (tokens[0].includes('/')) {
    const parts = tokens[0].split('/');
    if (parts.length === 2) {
      const numerator = parseFloat(parts[0]);
      const denominator = parseFloat(parts[1]);
      if (!isNaN(numerator) && !isNaN(denominator) && denominator !== 0) {
        return { qty: numerator / denominator, consumed: 1 };
      }
    }
  }

  // Handle simple numbers (integers and decimals)
  const num = parseFloat(tokens[0]);
  if (!isNaN(num)) {
    qty = num;
    consumed = 1;
  } else {
    return null;
  }

  return { qty, consumed };
}
