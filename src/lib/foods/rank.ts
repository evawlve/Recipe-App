import Fuse from 'fuse.js';
import { plausibilityScore, KcalBand } from './plausibility';
import { normalizeQuery } from '@/lib/search/normalize';

// tokens in the query → nudge these categories
const HINTS: Record<string, string[]> = {
  powder: ['whey','flour'],
  whey: ['whey'],
  oil: ['oil'],
  yogurt: ['dairy'],
  yoghurt: ['dairy'],
  cheese: ['cheese'],
  mozzarella: ['cheese'],
  cheddar: ['cheese'],
  parmesan: ['cheese'],
  milk: ['dairy'],
  // Expanded hints for better category matching
  chicken: ['meat'],
  beef: ['meat'],
  pork: ['meat'],
  thigh: ['meat'],
  drumstick: ['meat'],
  wing: ['meat'],
  broth: ['meat'], // Broths are often in meat category
  bouillon: ['meat'],
  stock: ['meat'],
  ketchup: ['sugar'], // Condiments often have sugar
  catsup: ['sugar'],
  vinegar: ['sugar'],
  sriracha: ['sugar'],
  soy: ['sugar'],
  miso: ['sugar'],
  mirin: ['sugar'],
  gochujang: ['sugar'],
  fish: ['meat'],
  coconut: ['oil'],
};

function categoryBoostForQuery(q: string): Record<string, number> {
  const boosts: Record<string, number> = {};
  for (const t of normalizeQuery(q).split(' ')) {
    for (const c of (HINTS[t] || [])) boosts[c] = Math.max(boosts[c] ?? 0, 1.2);
  }
  return boosts;
}

function isCompositeName(name: string) {
  const s = name.toLowerCase();
  return s.includes(',') || s.includes(' with ') || s.includes(' and ');
}

// PHASE B: Helper functions for improved ranking

function extractFatQualifiers(text: string): string[] {
  const lowerText = text.toLowerCase();
  const qualifiers: string[] = [];
  
  if (lowerText.includes('skim') || lowerText.includes('nonfat') || lowerText.includes('non-fat')) {
    qualifiers.push('skim');
  }
  if (lowerText.includes('lowfat') || lowerText.includes('low-fat') || lowerText.includes('low fat')) {
    qualifiers.push('lowfat');
  }
  if (lowerText.match(/\b1%\b/)) qualifiers.push('1%');
  if (lowerText.match(/\b2%\b/)) qualifiers.push('2%');
  if (lowerText.includes('whole') || lowerText.includes('3.25%')) qualifiers.push('whole');
  
  return qualifiers;
}

function inferQueryCategory(query: string): string | null {
  const lowerQuery = query.toLowerCase();
  const words = lowerQuery.split(/\s+/);
  
  // Exact word matches (not substrings)
  if (words.includes('milk') && !lowerQuery.includes('chocolate')) {
    if (lowerQuery.includes('oat')) return 'oat_milk';
    if (lowerQuery.includes('almond')) return 'almond_milk';
    if (lowerQuery.includes('soy')) return 'soy_milk';
    if (lowerQuery.includes('coconut')) return 'coconut_milk';
    return 'milk';
  }
  
  if (words.includes('oil')) return 'oil';
  if (words.includes('salt')) return 'salt';
  if (words.includes('sugar') && !lowerQuery.includes('blood')) return 'sugar';
  if (words.includes('yogurt') || words.includes('yoghurt')) return 'yogurt';
  if (words.includes('cheese')) return 'cheese';
  if (words.includes('tofu')) return 'tofu';
  
  return null;
}

export type Verification = 'verified' | 'unverified' | 'suspect';

export type CandidateFood = {
  id: string;
  name: string;
  brand?: string | null;
  source: string;
  verification: Verification;
  kcal100: number;
  protein100: number;
  carbs100: number;
  fat100: number;
  densityGml?: number | null;
  categoryId?: string | null;
  popularity: number;
};

export type Candidate = {
  food: CandidateFood;
  aliases?: string[];
  barcodes?: string[];
  usedByUserCount?: number; // personalize later
};

export type RankOpts = {
  query: string;
  kcalBand?: KcalBand;
  unitHint?: string | null;      // NEW: from parser (e.g., "yolk", "white", "leaf", "clove")
  qualifiers?: string[];          // NEW: from parser (e.g., ["large"], ["diced", "fresh"])
};

export function rankCandidates(cands: Candidate[], opts: RankOpts) {
  // Dynamic threshold based on query length (shorter queries need tighter matches)
  const queryLength = opts.query.trim().split(/\s+/).length;
  const baseThreshold = 0.3; // Lowered from 0.4 for better recall
  const threshold = queryLength <= 2 ? baseThreshold : baseThreshold + 0.1; // Tighter for short queries
  
  const fuse = new Fuse(
    cands.map(c => ({
      key: c.food.id,
      text: `${c.food.brand ?? ''} ${c.food.name} ${(c.aliases ?? []).join(' ')}`.trim(),
      c,
    })),
    { includeScore: true, threshold, keys: ['text'] }
  );
  const fResults = fuse.search(opts.query);
  const fuzzyScore: Record<string, number> = {};
  for (const r of fResults) {
    const rawScore = r.score ?? 1;
    const normalizedScore = 1 - rawScore;
    // Boost fuzzy score when it's very close (< 0.2)
    if (rawScore < 0.2) {
      fuzzyScore[r.item.c.food.id] = normalizedScore * 1.3; // 30% boost for very close matches
    } else {
      fuzzyScore[r.item.c.food.id] = normalizedScore;
    }
  }

  const qn = normalizeQuery(opts.query);
  const boosts = categoryBoostForQuery(qn);
  const qHasCompositeWords = /,| with | and | salad| sandwich| pizza/.test(qn);

  // PHASE 7: Pre-check which foods have important query terms in their NAME (not just aliases)
  // This helps us penalize foods that only match via aliases when better name matches exist
  const queryTokens = opts.query.toLowerCase().split(/\s+/).filter(Boolean);
  // Common words that can be filtered out UNLESS they're part of a multi-word phrase
  // For example, "rice" in "brown rice" is important, but "rice" alone might be common
  const commonWords = ['cooked', 'raw', 'fresh', 'diced', 'chopped', 'sliced', 'cup', 'tbsp', 'tsp', 'and', 'the', 'a', 'an'];
  // For multi-word queries, be more conservative - only filter out truly common words
  // Single-word queries can filter more aggressively
  const importantTerms = queryTokens.length > 1 
    ? queryTokens.filter(t => !commonWords.includes(t.toLowerCase()) && t.length > 2) // Multi-word: keep "rice", "brown", etc.
    : queryTokens.filter(t => !commonWords.includes(t.toLowerCase()) && t.length > 2); // Single-word: same logic
  
  const foodsWithTermsInName = new Set<string>();
  const foodsWithTermsAsPhrase = new Set<string>();
  if (importantTerms.length > 0) {
    // Check if query terms form a phrase (e.g., "brown rice", "ground beef")
    const queryPhrase = opts.query.toLowerCase();
    
    for (const cand of cands) {
      const foodNameLower = cand.food.name.toLowerCase();
      // Check if ALL important terms are in the food name (not aliases)
      const hasAllTermsInName = importantTerms.every(term => foodNameLower.includes(term.toLowerCase()));
      if (hasAllTermsInName) {
        foodsWithTermsInName.add(cand.food.id);
        
        // Check if the terms appear together as a phrase in the food name
        // Order doesn't matter - "shredded coconut" should match "coconut, canned, shredded"
        // But terms should be relatively close together to avoid false matches
        if (importantTerms.length >= 2) {
          // Find all term positions in the food name (order doesn't matter)
          const termsLower = importantTerms.map(t => t.toLowerCase());
          const termPositions: number[] = [];
          for (const term of termsLower) {
            const termIndex = foodNameLower.indexOf(term);
            if (termIndex === -1) {
              // Term not found - not a phrase match
              break;
            }
            termPositions.push(termIndex);
          }
          
          // If all terms found, check if they're relatively close together AND in a natural phrase context
          // This allows "coconut, canned, shredded" to match "shredded coconut"
          // But prevents "brown and serve" + "rice links" from matching "brown rice"
          if (termPositions.length === termsLower.length) {
            const minPos = Math.min(...termPositions);
            const maxPos = Math.max(...termPositions);
            const distance = maxPos - minPos;
            
            // Terms should be within 50 characters of each other
            if (distance <= 50) {
              // Get the substring BETWEEN the terms (not including the terms themselves)
              // Find which term is first and which is last
              const firstTermIndex = termPositions.indexOf(minPos);
              const lastTermIndex = termPositions.indexOf(maxPos);
              const firstTerm = termsLower[firstTermIndex];
              const lastTerm = termsLower[lastTermIndex];
              
              // Get text after first term and before last term
              const afterFirstTerm = minPos + firstTerm.length;
              const substringBetween = foodNameLower.substring(afterFirstTerm, maxPos);
              
              // Check if the substring between terms contains words that break the phrase
              // Words like "links", "and", "serve", "sausage" suggest the terms aren't part of the same phrase
              const phraseBreakingWords = ['links', 'and', 'serve', 'sausage', 'with', 'or', 'plus', 'pork'];
              const hasBreakingWords = phraseBreakingWords.some(word => substringBetween.includes(word));
              
              // Also check if terms are separated by too many content words (more than 2-3 words)
              const wordsBetween = substringBetween.split(/\s+/).filter(w => w.length > 2 && !w.match(/^[,;:]+$/));
              
              // If no breaking words and not too many words between, it's a valid phrase match
              if (!hasBreakingWords && wordsBetween.length <= 3) {
                foodsWithTermsAsPhrase.add(cand.food.id);
              }
            }
          }
        } else {
          // Single important term - if it's in the name, consider it a phrase match
          foodsWithTermsAsPhrase.add(cand.food.id);
        }
      }
    }
  }

  return cands.map(c => {
    const q = opts.query.toLowerCase();
    const f = c.food;
    const barcodeHit = (c.barcodes ?? []).some(b => q.replace(/\D/g, '') === b);
    const exactBrand = f.brand ? +q.includes(f.brand.toLowerCase()) : 0;
    // Improved alias matching with tokenization and fuzzy matching
    const aliases = (c.aliases ?? []).map(a => a.toLowerCase());
    const queryLower = q.toLowerCase();
    const queryTokens = queryLower.split(/\s+/).filter(Boolean);
    
    let exactAlias = 0;
    let aliasMatch = 0;
    let aliasTokenMatches = 0;
    
    for (const alias of aliases) {
      // Exact alias match
      if (alias === queryLower) {
        exactAlias = 1;
        break;
      }
      
      // Tokenized alias matching
      const aliasTokens = alias.split(/\s+/);
      const matchedTokens = queryTokens.filter(qt => 
        aliasTokens.some(at => at === qt || at.includes(qt) || qt.includes(at))
      );
      
      if (matchedTokens.length > 0) {
        aliasTokenMatches = Math.max(aliasTokenMatches, matchedTokens.length / queryTokens.length);
      }
      
      // Substring alias match (case-insensitive)
      if (alias.includes(queryLower) || queryLower.includes(alias)) {
        aliasMatch = Math.max(aliasMatch, 0.8);
      }
    }
    
    // Boost when multiple aliases match query
    if (aliasTokenMatches > 0.5) {
      aliasMatch = Math.max(aliasMatch, aliasTokenMatches);
    }
    
    // Boost for tokenized alias matches
    if (aliasTokenMatches > 0) {
      aliasMatch = Math.max(aliasMatch, aliasTokenMatches * 0.9);
    }
    
    // PHASE 7: Penalize alias-only matches and non-phrase matches when better phrase matches exist
    // If other foods have important terms as a PHRASE in their NAME, heavily penalize:
    // 1. Foods that only match via aliases
    // 2. Foods that have the terms but not as a phrase (e.g., "brown and serve" + "rice links" vs "brown rice")
    // Example: "brown rice" query should NOT match "Pork sausage rice links, brown and serve" 
    //          (has "brown" and "rice" separately) when "Rice, brown, long-grain, cooked" exists (has "brown rice" as phrase)
    let aliasOnlyPenalty = 0;
    if (importantTerms.length > 0 && foodsWithTermsAsPhrase.size > 0) {
      const foodNameLower = f.name.toLowerCase();
      const hasTermsInName = importantTerms.every(term => foodNameLower.includes(term.toLowerCase()));
      
      // Check if terms appear as a phrase in the food name (order doesn't matter, but should be close together)
      let hasTermsAsPhrase = false;
      if (importantTerms.length >= 2) {
        const termsLower = importantTerms.map(t => t.toLowerCase());
        const termPositions: number[] = [];
        for (const term of termsLower) {
          const termIndex = foodNameLower.indexOf(term);
          if (termIndex === -1) {
            break; // Term not found
          }
          termPositions.push(termIndex);
        }
        
        // If all terms found, check if they're relatively close together AND in a natural phrase context
        if (termPositions.length === termsLower.length) {
          const minPos = Math.min(...termPositions);
          const maxPos = Math.max(...termPositions);
          const distance = maxPos - minPos;
          
          if (distance <= 50) {
            // Get the substring BETWEEN the terms (not including the terms themselves)
            const firstTermIndex = termPositions.indexOf(minPos);
            const lastTermIndex = termPositions.indexOf(maxPos);
            const firstTerm = termsLower[firstTermIndex];
            const afterFirstTerm = minPos + firstTerm.length;
            const substringBetween = foodNameLower.substring(afterFirstTerm, maxPos);
            
            // Check if the substring between terms contains words that break the phrase
            const phraseBreakingWords = ['links', 'and', 'serve', 'sausage', 'with', 'or', 'plus', 'pork'];
            const hasBreakingWords = phraseBreakingWords.some(word => substringBetween.includes(word));
            
            // Also check if terms are separated by too many content words
            const wordsBetween = substringBetween.split(/\s+/).filter(w => w.length > 2 && !w.match(/^[,;:]+$/));
            
            // If no breaking words and not too many words between, it's a valid phrase match
            hasTermsAsPhrase = !hasBreakingWords && wordsBetween.length <= 3;
          }
        }
      } else {
        hasTermsAsPhrase = hasTermsInName; // Single term - if it's in name, it's a phrase match
      }
      
      if (!hasTermsAsPhrase) {
        if (!hasTermsInName && aliasMatch > 0) {
          // This food only matches via aliases, but other foods have the terms as a phrase in their name
          aliasOnlyPenalty = -10.0; // Very strong penalty for alias-only matches when phrase matches exist
        } else if (hasTermsInName && !hasTermsAsPhrase) {
          // This food has the terms but not as a phrase (e.g., "brown and serve" + "rice links")
          // Other foods have the terms as a phrase - heavily penalize this one
          // This is critical - "brown rice" should match "Rice, brown, long-grain" not "Pork sausage rice links, brown and serve"
          aliasOnlyPenalty = -12.0; // Very strong penalty for non-phrase matches when phrase matches exist
        }
      }
    } else if (importantTerms.length > 0 && foodsWithTermsInName.size > 0) {
      // Fallback: if no phrase matches but name matches exist, still penalize alias-only matches
      const foodNameLower = f.name.toLowerCase();
      const hasTermsInName = importantTerms.every(term => foodNameLower.includes(term.toLowerCase()));
      
      if (!hasTermsInName && aliasMatch > 0) {
        aliasOnlyPenalty = -8.0; // Penalty for alias-only matches when name matches exist
      }
    }
    const fuzzy = fuzzyScore[f.id] ?? 0;
    const plaus = plausibilityScore(f.kcal100, opts.kcalBand);

    const verified = f.verification === 'verified' ? 1 : f.verification === 'suspect' ? 0.2 : 0.6;
    const popularity = Math.tanh((f.popularity || 0) / 50);
    const personal = Math.tanh((c.usedByUserCount || 0) / 10);

    // Enhanced token matching with exact/partial matching and position weighting
    const tokens = q.split(/\s+/).filter(Boolean);
    const nameTokens = `${(f.brand ?? '')} ${f.name}`.toLowerCase().split(/\s+/);
    let tokenScore = 0;
    let exactMatches = 0;
    let partialMatches = 0;
    let wholeWordMatches = 0;
    
    for (const qToken of tokens) {
      // Check for exact token match
      const exactMatch = nameTokens.some(nToken => nToken === qToken);
      if (exactMatch) {
        tokenScore += 1.0;
        exactMatches++;
        
        // PHASE 3 FIX: Whole-word bonus - prefer "milk" as standalone word vs substring
        // Check if this token appears as a complete word (not as part of longer word)
        const fullFoodText = `${f.brand ?? ''} ${f.name}`.toLowerCase();
        const wordBoundaryRegex = new RegExp(`\\b${qToken}\\b`, 'i');
        if (wordBoundaryRegex.test(fullFoodText)) {
          wholeWordMatches++;
          tokenScore += 0.3; // Bonus for whole-word match
        }
        
        // Position weighting: tokens at start of food name get higher weight
        const tokenIndex = nameTokens.findIndex(nToken => nToken === qToken);
        if (tokenIndex < 2) { // First two tokens
          tokenScore += 0.2; // Extra boost for early position
        }
      } else {
        // Check for partial token match (substring)
        const partialMatch = nameTokens.some(nToken => 
          nToken.includes(qToken) || qToken.includes(nToken)
        );
        if (partialMatch) {
          tokenScore += 0.5;
          partialMatches++;
        }
      }
    }
    
    // Multi-word query handling: "chicken breast" should match both tokens
    // Bonus if all tokens match
    const allTokensMatch = exactMatches === tokens.length;
    if (allTokensMatch && tokens.length > 1) {
      tokenScore += 0.3; // Extra boost for complete multi-word match
    }
    
    // PHASE 3 FIX: Extra boost if query is short and all tokens are whole-word matches
    if (tokens.length <= 2 && wholeWordMatches === tokens.length) {
      tokenScore += 0.4; // Strong boost for exact short queries like "milk" matching "Milk, Whole"
    }
    
    const tokenBoost = Math.min(1, tokenScore / Math.max(1, tokens.length)); // 0..1

    // Unit hint boost (e.g., "egg yolks" → boost foods with "yolk" in name)
    let unitHintBoost = 0;
    let unitHintPenalty = 1.0;
    const foodNameLower = f.name.toLowerCase();
    
    // PHASE 6: Penalize foods missing key query terms
    // If query has multiple important terms (like "brown rice"), foods missing those terms should be penalized
    // Example: "brown rice" query should NOT match "rice noodles" (missing "brown")
    let missingTermPenalty = 0;
    if (tokens.length >= 2) {
      // For multi-word queries, check if food name contains all important terms
      // Important terms are those that aren't common words like "rice", "cooked", etc.
      const commonWords = ['rice', 'cooked', 'raw', 'fresh', 'diced', 'chopped', 'sliced', 'cup', 'tbsp', 'tsp'];
      const importantTerms = tokens.filter(t => !commonWords.includes(t.toLowerCase()) && t.length > 2);
      
      if (importantTerms.length > 0) {
        // Check food NAME specifically (not aliases) for important terms
        // This prevents "Rice noodles" (which has "brown rice" in aliases) from matching "brown rice" queries
        // Important terms should appear in the actual food name, not just aliases
        const missingTerms = importantTerms.filter(term => !foodNameLower.includes(term.toLowerCase()));
        
        if (missingTerms.length > 0) {
          // Penalize foods missing important query terms in their NAME
          // This is critical - "brown rice" should NOT match "rice noodles" even if noodles has "brown rice" in aliases
          // Need very strong penalty to overcome other scoring factors
          missingTermPenalty = -10.0 * missingTerms.length; // Very strong penalty per missing important term
        }
      }
    }
    
    if (opts.unitHint) {
      const hint = opts.unitHint.toLowerCase();
      
      // Exact match in food name (e.g., "Egg, yolk, raw")
      if (foodNameLower.includes(hint)) {
        unitHintBoost = 1.0; // Moderate boost (reduced from 1.5)
      }
      
      // Partial match with pluralization (e.g., "yolk" → "yolks")
      const hintPattern = new RegExp(`\\b${hint}s?\\b`, 'i');
      if (hintPattern.test(foodNameLower)) {
        unitHintBoost = Math.max(unitHintBoost, 0.8); // Medium boost
      }
      
      // Special cases for eggs
      if (hint === 'yolk' && foodNameLower.includes('yolk')) {
        unitHintBoost = 1.2; // Prioritize yolk over whole (reduced)
      } else if (hint === 'white' && foodNameLower.includes('white')) {
        unitHintBoost = 1.2; // Prioritize white over whole (reduced)
      }
      
      // Lettuce leaf example: prefer raw lettuce for "leaves"
      if (hint === 'leaf' && foodNameLower.includes('raw')) {
        unitHintBoost = Math.max(unitHintBoost, 0.8);
      }
      
      // Garlic clove example: prefer raw garlic
      if (hint === 'clove' && foodNameLower.includes('raw') && foodNameLower.includes('garlic')) {
        unitHintBoost = Math.max(unitHintBoost, 0.8);
      }
    } else {
      // No unit hint: de-rank parts (yolk/white) when query doesn't specify
      if ((foodNameLower.includes('yolk') || foodNameLower.includes('white')) && 
          !q.includes('yolk') && !q.includes('white')) {
        unitHintPenalty = 0.5; // Moderate penalty (increased from 0.4)
      }
    }

    // PHASE B1: Enhanced qualifier matching with fat content exactness
    let qualifierBoost = 0;
    let qualifierPenalty = 0;
    
    // Extract fat qualifiers from query and food name
    const queryFatQuals = extractFatQualifiers(q);
    const foodFatQuals = extractFatQualifiers(foodNameLower);
    
    // Exact fat qualifier match: strong boost
    if (queryFatQuals.length > 0 && foodFatQuals.length > 0) {
      const hasExactMatch = queryFatQuals.some(qf => foodFatQuals.includes(qf));
      if (hasExactMatch) {
        qualifierBoost += 0.8; // Strong boost for exact fat qualifier match
      } else {
        // Query says "skim milk" but food is "2% milk" → penalty
        qualifierPenalty -= 0.6; // Strong penalty for contradicting fat qualifier
      }
    } else if (queryFatQuals.length > 0 && foodFatQuals.length === 0) {
      // Query specifies fat content, food doesn't mention it
      // Mild penalty (food might be generic)
      qualifierPenalty -= 0.2;
    }
    
    // Original qualifier logic (size, prep, etc.)
    if (opts.qualifiers && opts.qualifiers.length > 0) {
      const matchedQualifiers = opts.qualifiers.filter(q => 
        foodNameLower.includes(q.toLowerCase())
      );
      
      // Boost proportional to matched qualifiers
      qualifierBoost += matchedQualifiers.length * 0.3; // 0.3 per match
      
      // Special handling for size qualifiers
      const sizeQualifiers = ['large', 'medium', 'small', 'jumbo', 'extra large', 'xl', 'l', 'm', 's'];
      const hasSizeQualifier = opts.qualifiers.some(q => 
        sizeQualifiers.includes(q.toLowerCase())
      );
      
      if (hasSizeQualifier) {
        const foodHasSize = sizeQualifiers.some(s => foodNameLower.includes(s));
        if (foodHasSize) {
          qualifierBoost += 0.5; // Extra boost for size match
        }
      }
      
      // Preparation qualifiers (diced, chopped, sliced) - prefer raw foods
      const prepQualifiers = ['diced', 'chopped', 'sliced', 'minced', 'grated'];
      const hasPrepQualifier = opts.qualifiers.some(q => 
        prepQualifiers.includes(q.toLowerCase())
      );
      
      if (hasPrepQualifier && foodNameLower.includes('raw')) {
        qualifierBoost += 0.2; // Small boost for raw + prep qualifier
      }
    }

    // PHASE 5: Strict Cooked/Raw State Matching (Critical)
    // Requirement: MUST respect entire ingredient name, especially state (raw/cooked)
    // Rules:
    // 1. Default to "raw" when state not specified (show user this assumption)
    // 2. NEVER match raw when cooked is specified - "cooked chicken breast" CANNOT match "chicken breast, raw"
    // 3. NEVER match cooked when raw is specified - "raw chicken breast" CANNOT match "chicken breast, cooked"
    // 4. Read entire ingredient name - check all qualifiers (cooked, raw, diced, sliced, etc.)
    
    let stateBoost = 0;
    let stateMismatch = false; // Track if there's a critical mismatch
    
    // Preparation state keywords (comprehensive)
    const cookedStates = ['cooked', 'baked', 'roasted', 'grilled', 'fried', 'boiled', 'steamed', 'sauteed', 'broiled', 'pan-fried', 'pan fried', 'deep-fried', 'deep fried'];
    const rawStates = ['raw', 'fresh', 'uncooked', 'unprepared'];
    const uncookedIndicators = ['dry', 'dried', 'uncooked', 'unprepared']; // Foods that are clearly not cooked
    const preparedStates = ['canned', 'prepared', 'ready-to-eat', 'ready to eat', 'processed'];
    
    // Extract state from query (check entire query string AND qualifiers)
    const qualifiersText = (opts.qualifiers || []).join(' ').toLowerCase();
    const fullQueryText = `${queryLower} ${qualifiersText}`;
    const queryCookedState = cookedStates.find(state => fullQueryText.includes(state));
    const queryRawState = rawStates.find(state => fullQueryText.includes(state));
    const queryPreparedState = preparedStates.find(state => fullQueryText.includes(state));
    const queryHasState = !!(queryCookedState || queryRawState || queryPreparedState);
    
    // Extract state from food name AND aliases (check entire name)
    const foodText = `${foodNameLower} ${(c.aliases || []).map((a: string) => a.toLowerCase()).join(' ')}`;
    const foodCookedState = cookedStates.find(state => foodText.includes(state));
    const foodRawState = rawStates.find(state => foodText.includes(state));
    const foodUncookedIndicator = uncookedIndicators.find(ind => foodText.includes(ind)); // Check for "dry", "dried", etc.
    const foodPreparedState = preparedStates.find(state => foodText.includes(state));
    const foodHasState = !!(foodCookedState || foodRawState || foodPreparedState || foodUncookedIndicator);
    
    // CRITICAL: Strong penalties for state mismatches (must never match)
    if (queryCookedState) {
      // Query wants cooked
      if (foodRawState) {
        stateMismatch = true; // CRITICAL: cooked query → raw food (NEVER match)
        stateBoost = -10.0; // Very strong penalty to prevent match
      } else if (foodUncookedIndicator) {
        // Food has "dry", "dried", "uncooked" - this is NOT cooked
        stateMismatch = true;
        stateBoost = -10.0; // Very strong penalty: "cooked pasta" CANNOT match "pasta, dry"
      } else if (foodCookedState) {
        // Very strong boost for matching cooked state
        // If query explicitly wants cooked, prioritize foods that say "cooked" even if token matching is weak
        // This should overcome token/simplicity/category penalties
        stateBoost += 8.0; // Increased from 5.0 - needs to be very strong to overcome other penalties
      } else {
        // Query wants cooked, but food doesn't specify cooked state
        // This is a mismatch - prefer foods that explicitly say "cooked"
        // Template foods get extra penalty since they're often generic/ambiguous
        const isTemplate = f.source === 'template';
        stateBoost = isTemplate ? -8.0 : -5.0; // Very strong penalty, even stronger for templates
      }
    } else if (queryRawState) {
      // Query wants raw
      if (foodCookedState || foodPreparedState) {
        stateMismatch = true; // CRITICAL: raw query → cooked/prepared food (NEVER match)
        stateBoost = -10.0; // Very strong penalty to prevent match
      } else if (foodRawState) {
        stateBoost += 0.5; // Boost for matching raw state
      }
    } else if (queryPreparedState) {
      // Query wants prepared
      if (foodRawState) {
        stateBoost -= 1.0; // Penalty: prepared query → raw food
      } else if (foodPreparedState) {
        stateBoost += 0.4; // Boost for matching prepared state
      }
    } else {
      // Query doesn't specify state - default to "raw" (show user this assumption)
      // Prefer raw foods, but don't penalize cooked too much (user might accept either)
      if (foodRawState) {
        stateBoost += 0.2; // Small boost for raw (default assumption)
      } else if (foodCookedState && !foodHasState) {
        // Food name doesn't explicitly say "cooked" but might be cooked
        // Don't penalize too much, but prefer raw
        stateBoost -= 0.1; // Small penalty
      }
    }

    // PHASE B2: Name simplicity scoring
    const queryWords = q.split(/\s+/).length;
    const foodWords = f.name.split(/\s+/).length;
    let simplicityBoost = 0;
    
    // Prefer foods with similar or fewer words than query
    if (foodWords <= queryWords) {
      simplicityBoost = 0.25; // Boost simpler names
    } else if (foodWords > queryWords + 4) {
      // Penalize overly verbose names
      simplicityBoost = -0.3;
    }
    
    // Prefer template foods (curated, simple names) over USDA
    if (f.source === 'template') {
      simplicityBoost += 0.4; // Strong boost for template foods
    }
    
    // PHASE E2: Derivative/Condiment Penalty
    // Prevent condiments/derivatives from matching base ingredient queries
    const DERIVATIVE_MAP: Record<string, string[]> = {
      'tomato': ['ketchup', 'catsup', 'tomato sauce', 'tomato paste', 'salsa'],
      'milk': ['coconut milk', 'oat milk', 'almond milk', 'soy milk', 'rice milk', 'yogurt', 'greek yogurt', 'cheese'], // Prevent yogurt/cheese matching "milk"
      'avocado': ['avocado oil'],
      'coconut': ['coconut oil'], // "coconut" should match "coconut milk" but NOT "coconut oil"
      'coconut oil': ['coconut milk'], // "coconut oil" should NOT match "coconut milk"
      'olive': ['olive oil'],
      'peanut': ['peanut oil'],
      'sesame': ['sesame oil'],
      'chicken': ['chicken broth', 'chicken stock', 'chicken bouillon'],
      'beef': ['beef broth', 'beef stock', 'beef bouillon'],
    };
    
    let derivativePenalty = 0;
    
    for (const baseFood in DERIVATIVE_MAP) {
      // Check if query contains base food (handle both single-word and multi-word like "coconut oil")
      const baseFoodRegex = new RegExp(`\\b${baseFood.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
      if (baseFoodRegex.test(queryLower)) {
        // Check if food name OR ALIASES contain a derivative (e.g., "ketchup")
        const derivatives = DERIVATIVE_MAP[baseFood];
        const foodNameOrAliases = [foodNameLower, ...(c.aliases || []).map(a => a.toLowerCase())].join(' ');
        
        if (derivatives.some(d => {
          // Use word boundary to match whole words
          const dRegex = new RegExp(`\\b${d.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
          return dRegex.test(foodNameOrAliases);
        })) {
          // UNLESS query explicitly mentions the derivative (e.g., "tomato ketchup", "coconut milk")
          if (!derivatives.some(d => queryLower.includes(d))) {
            derivativePenalty = -5.0; // Even stronger penalty - should never match
          }
        }
      }
    }
    
    // PHASE E2: Exact Qualifier Matching
    // Strengthen penalties for missing exact qualifiers like "2%", "skim", etc.
    const extractExactQualifiers = (text: string): string[] => {
      const qualifiers: string[] = [];
      if (text.match(/\b2%\b/)) qualifiers.push('2%');
      if (text.match(/\b1%\b/)) qualifiers.push('1%');
      if (text.match(/\bskim\b|\bnonfat\b/i)) qualifiers.push('skim');
      if (text.match(/\bwhole\b/i)) qualifiers.push('whole');
      if (text.match(/\blowfat\b|low-fat\b|low fat\b/i)) qualifiers.push('lowfat');
      return qualifiers;
    };
    
    const queryExactQualifiers = extractExactQualifiers(queryLower);
    const foodExactQualifiers = extractExactQualifiers(foodNameLower);
    
    let exactQualifierPenalty = 0;
    for (const qq of queryExactQualifiers) {
      if (!foodExactQualifiers.includes(qq)) {
        exactQualifierPenalty -= 3.0; // Very strong penalty for missing exact qualifier (e.g., "2%" in query but not in food)
      }
    }
    
    // PHASE B3: Category incompatibility matrix
    const INCOMPATIBLE_CATEGORIES: Record<string, string[]> = {
      'milk': ['cheese', 'yogurt', 'dessert', 'sugar', 'soup'],
      'oat_milk': ['dessert', 'sugar'],
      'almond_milk': ['dessert', 'sugar'],
      'soy_milk': ['dessert', 'sugar'],
      'yogurt': ['milk', 'cheese'],
      'cheese': ['milk', 'yogurt'],
      'oil': ['veg', 'fruit', 'grain', 'meat'],
      'salt': ['veg', 'fruit', 'meat', 'grain'],
      'sugar': ['veg', 'fruit', 'meat'],
      'tofu': ['meat', 'dairy']
    };
    
    const queryCategory = inferQueryCategory(q);
    const foodCategory = f.categoryId?.toLowerCase() || '';
    
    // Check for category incompatibility
    if (queryCategory && INCOMPATIBLE_CATEGORIES[queryCategory]?.includes(foodCategory)) {
      // Return strong negative penalty immediately
      return {
        candidate: c,
        score: -10, // Very strong penalty for incompatible categories
        confidence: 0
      };
    }
    
    // Enhanced category-based boosting with reverse lookup and penalties
    const categoryBoost = (() => {
      const queryLower = q.toLowerCase();
      const foodCategory = f.categoryId?.toLowerCase() || '';
      
      // Reverse lookup: if food category matches query category hint → boost
      const queryTokens = queryLower.split(/\s+/);
      let boost = simplicityBoost; // Start with simplicity score
      
      for (const token of queryTokens) {
        const categoryHints = HINTS[token] || [];
        if (categoryHints.includes(foodCategory)) {
          boost = Math.max(boost, 0.4); // Stronger boost for category match
        }
      }
      
      // Specific category matches
      if ((queryLower.includes('oil') || queryLower.includes('fat')) && foodCategory === 'oil') {
        boost = Math.max(boost, 0.4);
      }
      
      if (queryLower.includes('flour') && foodCategory === 'flour') {
        boost = Math.max(boost, 0.4);
      }
      
      if ((queryLower.includes('chicken') || queryLower.includes('beef') || queryLower.includes('pork') || queryLower.includes('protein')) && 
          (foodCategory === 'meat' || foodCategory === 'whey')) {
        boost = Math.max(boost, 0.4);
      }
      
      // PHASE C FIX 1: Enhanced milk/dairy matching
      // When query is "milk" (and NOT cheese), strongly penalize cheese
      if (queryLower.includes('milk') && !queryLower.includes('cheese')) {
        const foodNameLower = f.name.toLowerCase();
        
        // PHASE D FIX: Very strong penalty for foods containing milk as ingredient (not main food)
        if (foodNameLower.includes('soup') || foodCategory === 'soup') {
          return -2.5; // Extremely strong penalty - milk is not soup!
        }
        
        // Penalize foods where milk is an ingredient, not the main food
        if (foodNameLower.includes('made with') || 
            foodNameLower.includes('prepared with') ||
            foodNameLower.includes('containing') ||
            foodNameLower.includes('recipe') ||
            foodNameLower.includes('mix,') ||
            foodNameLower.includes('mixture')) {
          return -2.5; // Very strong penalty for foods with milk as ingredient
        }
        
        // Penalize desserts and baked goods when searching for milk
        if (foodCategory === 'dessert' || foodCategory === 'sugar' ||
            foodNameLower.includes('muffin') ||
            foodNameLower.includes('cake') ||
            foodNameLower.includes('cookie') ||
            foodNameLower.includes('pie') ||
            foodNameLower.includes('pudding')) {
          return -2.0; // Strong penalty for desserts when searching for milk
        }
        
        // Very strong penalty for flavored/specialty milks
        if (foodNameLower.includes('eggnog') || 
            foodNameLower.includes('chocolate') ||
            foodNameLower.includes('strawberry') ||
            foodNameLower.includes('vanilla') ||
            foodNameLower.includes('flavored')) {
          return -1.5; // Very strong penalty for flavored milk products
        }
        
        // Penalize cheese
        if (foodCategory === 'cheese' || foodNameLower.includes('cheese') || foodNameLower.includes('ricotta')) {
          return -0.8; // Strong penalty for cheese when query says milk
        }
        
        // Unless query specifies fat content, prefer whole milk
        const querySpecifiesFat = queryLower.includes('skim') || 
                                  queryLower.includes('nonfat') || 
                                  queryLower.includes('lowfat') ||
                                  queryLower.includes('low-fat') ||
                                  queryLower.includes('1%') ||
                                  queryLower.includes('2%');
        
        if (!querySpecifiesFat) {
          // Query says just "milk" → prefer whole milk
          if (foodNameLower.includes('lowfat') || 
              foodNameLower.includes('skim') ||
              foodNameLower.includes('nonfat') ||
              foodNameLower.match(/\b1%\b/) ||
              foodNameLower.match(/\b2%\b/)) {
            return -0.6; // Moderate penalty for non-whole milk
          }
        }
      }
      
      if (queryLower.includes('cheese') && foodCategory === 'dairy' && !foodCategory.includes('cheese')) {
        return -0.2; // Small penalty for generic dairy when query wants cheese
      }
      
      // PHASE C FIX 2: Strengthened category penalties for wrong matches
      const foodNameLower = f.name.toLowerCase();
      
      // Mustard → don't match mustard spinach (vegetable)
      if (queryLower.includes('mustard') && !queryLower.includes('spinach') && foodCategory === 'veg') {
        return -1.5; // Very strong penalty for vegetables when searching for condiment (increased from -0.6)
      }
      
      // Oat milk, almond milk → don't match chocolate/candy
      if ((queryLower.includes('oat milk') || queryLower.includes('almond milk') || queryLower.includes('soy milk')) &&
          (foodCategory === 'dessert' || foodCategory === 'sugar' || foodNameLower.includes('chocolate') || foodNameLower.includes('candy'))) {
        return -1.8; // Very strong penalty for sweets when searching for milk (increased from -0.8)
      }
      
      // Vinegar → don't match vegetables/greens
      if (queryLower.includes('vinegar') && !queryLower.includes('spinach') && foodCategory === 'veg') {
        return -0.5; // Penalty for vegetables when searching for condiment
      }
      
      // PHASE C FIX 3: Enhanced condiment/sauce category boosting
      const condimentQueries = ['mustard', 'ketchup', 'vinegar', 'sriracha', 'sauce', 'mayo', 'mayonnaise'];
      const isCondimentQuery = condimentQueries.some(c => {
        const tokens = queryLower.split(/\s+/);
        return tokens.includes(c); // Exact token match for condiment
      });
      
      if (isCondimentQuery) {
        if (foodCategory === 'sauce' || foodCategory === 'condiment') {
          boost = Math.max(boost, 0.8); // Strong boost for sauce/condiment category (increased from 0.6)
        } else if (foodCategory === 'veg') {
          return -1.5; // Very strong penalty for vegetables when searching for condiments
        }
      }
      
      // Beverage queries → penalize solid foods
      const beverageQueries = ['milk', 'juice', 'water', 'coffee', 'tea'];
      const solidFoodCategories = ['meat', 'veg', 'fruit', 'legume', 'flour'];
      if (beverageQueries.some(b => queryLower.includes(b) && queryLower.split(/\s+/).includes(b)) && 
          solidFoodCategories.includes(foodCategory)) {
        return -0.7; // Strong penalty for solid foods when searching for beverages
      }
      
      // PHASE D FIX: Additional wrong category penalties
      // Salt → don't match vegetables
      if (queryLower === 'salt' || queryLower.includes('salt,') || queryLower.includes('salt ')) {
        if (foodCategory === 'veg' || foodCategory === 'fruit') {
          return -2.0; // Very strong penalty for produce when searching for salt
        }
      }
      
      // Sugar → don't match fruit
      if (queryLower === 'sugar' || queryLower.includes('sugar,') || queryLower.includes('sugar ')) {
        if (foodCategory === 'fruit' || foodCategory === 'veg') {
          return -2.0; // Very strong penalty for produce when searching for sugar
        }
      }
      
      // Tomato (diced/chopped) → prefer raw tomatoes over sauce
      if ((queryLower.includes('tomato, diced') || queryLower.includes('tomato, chopped') || 
           queryLower.includes('tomatoes, diced') || queryLower.includes('tomatoes, chopped')) &&
          (foodNameLower.includes('sauce') || foodNameLower.includes('canned') || foodNameLower.includes('paste'))) {
        return -1.5; // Strong penalty for processed tomato products when query says "diced" or "chopped"
      }
      
      // PHASE C FIX 4: Boost template foods and plain/generic matches
      const isPlainFood = (
        !foodNameLower.includes('flavored') &&
        !foodNameLower.includes('chocolate') &&
        !foodNameLower.includes('vanilla') &&
        !foodNameLower.includes('strawberry') &&
        !foodNameLower.includes('special') &&
        !foodNameLower.includes('deluxe') &&
        !foodNameLower.includes('premium')
      );
      
      // Boost plain versions for single-word queries (e.g., "milk", "mustard", "flour")
      if (queryLower.split(/\s+/).length === 1 && isPlainFood) {
        boost += 0.4; // Boost plain versions
      }
      
      // Boost template foods (user-created generic foods) over specific USDA entries
      if (f.source === 'template') {
        boost += 0.3; // Template foods are usually more generic/user-friendly
      }
      
      return boost;
    })();

    const w = { 
      barcode: 3.0, 
      exact: 1.5, 
      alias: 1.2, 
      aliasMatch: 1.5, 
      fuzzy: 2.0, 
      plaus: 1.0, 
      verified: 0.8, 
      popularity: 0.7, 
      personal: 1.0, 
      token: 1.8,          // Increased from 1.5 for enhanced token matching
      category: 1.2,       // Increased from 1.0 for better category boosting
      unitHint: 1.5,       
      qualifier: 1.2,      // PHASE B: Increased from 0.8 for stronger qualifier matching
      state: 1.0           // PHASE 3: Weight for cooked/prepared state matching
    };

    let score =
      w.barcode * (barcodeHit ? 1 : 0) +
      w.exact   * exactBrand +
      w.alias   * exactAlias +
      w.aliasMatch * aliasMatch +
      w.fuzzy   * fuzzy +
      w.plaus   * plaus +
      w.verified* verified +
      w.popularity * popularity +
      w.personal   * personal +
      w.token   * tokenBoost +
      missingTermPenalty + // PHASE 6: Penalty for missing key query terms
      aliasOnlyPenalty + // PHASE 7: Penalty for alias-only matches when name matches exist
      w.category * Math.max(0, categoryBoost) + // Ensure non-negative
      w.unitHint * unitHintBoost +
      w.qualifier * (qualifierBoost + qualifierPenalty) + // PHASE B: Apply both boost and penalty
      w.state * stateBoost + // PHASE 3: Add state matching bonus/penalty
      simplicityBoost + // PHASE E2: Name simplicity bonus
      derivativePenalty + // PHASE E2: Derivative/condiment penalty
      exactQualifierPenalty; // PHASE E2: Exact qualifier penalty

    // Apply category hint boost
    if (f.categoryId && boosts[f.categoryId]) {
      score *= boosts[f.categoryId];
    }
    
    // Apply category penalty (negative categoryBoost)
    if (categoryBoost < 0) {
      score += categoryBoost * 2; // Apply penalty more strongly
    }
    
    // Apply unit hint penalty (for egg parts when no unitHint)
    score *= unitHintPenalty;

    // exact normalized alias hit → jump to top
    const normAliases = (c.aliases || []).map(a => normalizeQuery(a));
    if (normAliases.includes(qn)) score *= 2.0; // hard promote exact alias

    // modifier+head coverage → medium bump
    const hasNonfat = /\bnonfat\b/.test(qn) || /\bpart skim\b/.test(qn) || /\b2%|\b1%/.test(qn);
    const headCheese = /\bmozzarella\b|\bcheddar\b|\bcheese\b/.test(qn);
    const headMilk   = /\bmilk\b/.test(qn);
    if (hasNonfat && (headCheese || headMilk)) score *= 1.2;

    // REMOVED: Old cooked/raw state logic - replaced by Phase 3 implementation (lines 300-335)
    
    // De-rank composite dishes unless query asks for them
    if (!qHasCompositeWords && (f.categoryId === 'prepared_dish' || isCompositeName(f.name))) {
      score *= 0.6; // Moderate penalty to push plain ingredients up
    }
    
    // Milk vs Cheese disambiguation
    if (/\bmilk\b/.test(q) && !/(milk fat|milkfat|whole milk|skim milk|2% milk|1% milk)/i.test(foodNameLower)) {
      // Query says "milk" but food doesn't have "milk" as a primary descriptor
      if (/\bcheese\b|\bricotta\b|\bparmesan\b|\bcheddar\b|\bmozzarella\b/i.test(foodNameLower)) {
        score *= 0.3; // Strong penalty for cheese when "milk" is queried
      }
    }
    
    // Prefer specific brands when mentioned in query
    if (f.brand) {
      const brandLower = f.brand.toLowerCase();
      const queryTokens = q.split(/\s+/);
      for (const token of queryTokens) {
        if (brandLower.includes(token) || token.includes(brandLower)) {
          score *= 1.8; // Strong boost for brand match
          break;
        }
      }
    }
    
    // Greek yogurt preference
    if (/\bgreek\b/.test(q) && /\byogurt\b/.test(q)) {
      if (/\bgreek\b/.test(foodNameLower) && /\byogurt\b/.test(foodNameLower)) {
        score *= 1.5; // Boost greek yogurt
      } else if (/\byogurt\b/.test(foodNameLower) && !/\bgreek\b/.test(foodNameLower)) {
        score *= 0.5; // Penalize non-greek yogurt
      }
    }

    const confidence = Math.max(0, Math.min(1, score / 10.0));
    return { candidate: c, score, confidence };
  }).sort((a, b) => b.score - a.score);
}
