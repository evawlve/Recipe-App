import { rankCandidates } from './rank';

test('barcode match outranks fuzzy', () => {
  const cands = [
    { 
      food: { 
        id:'a', name:'Whey Isolate', brand:'BrandX', source:'community', verification:'verified', 
        kcal100:380, protein100:85, carbs100:5, fat100:2, densityGml:0.5, categoryId:null, popularity:10 
      }, 
      barcodes:['000111222333'] 
    },
    { 
      food: { 
        id:'b', name:'Whey Something', brand:'BrandY', source:'community', verification:'verified', 
        kcal100:380, protein100:85, carbs100:5, fat100:2, densityGml:0.5, categoryId:null, popularity:10 
      } 
    },
  ];
  const r = rankCandidates(cands as any, { query: '000111222333' });
  expect(r[0].candidate.food.id).toBe('a');
  expect(r[0].confidence).toBeGreaterThan(0.4);
});

test('plausibility band penalizes out-of-range kcal', () => {
  const cands = [
    { 
      food: { 
        id:'oil_ok', name:'Olive Oil', brand:null, source:'template', verification:'verified', 
        kcal100:884, protein100:0, carbs100:0, fat100:100, densityGml:0.91, categoryId:'oil', popularity:100 
      } 
    },
    { 
      food: { 
        id:'oil_bad', name:'Olive Oil (wrong)', brand:null, source:'community', verification:'unverified', 
        kcal100:120, protein100:0, carbs100:0, fat100:10, densityGml:0.91, categoryId:'oil', popularity:1 
      } 
    },
  ];
  const r = rankCandidates(cands as any, { query: 'olive oil', kcalBand: { min: 860, max: 900 } });
  expect(r[0].candidate.food.id).toBe('oil_ok');
});

test('verification status affects ranking', () => {
  const cands = [
    { 
      food: { 
        id:'verified', name:'Food A', brand:null, source:'template', verification:'verified', 
        kcal100:100, protein100:10, carbs100:20, fat100:5, densityGml:null, categoryId:null, popularity:50 
      } 
    },
    { 
      food: { 
        id:'suspect', name:'Food B', brand:null, source:'community', verification:'suspect', 
        kcal100:100, protein100:10, carbs100:20, fat100:5, densityGml:null, categoryId:null, popularity:50 
      } 
    },
  ];
  const r = rankCandidates(cands as any, { query: 'food' });
  expect(r[0].candidate.food.id).toBe('verified');
  expect(r[0].confidence).toBeGreaterThan(r[1].confidence);
});

test('exact token match beats fuzzy off-brand', () => {
  const cands = [
    { 
      food: { 
        id:'exact', name:'Olive Oil', brand:null, source:'template', verification:'verified', 
        kcal100:884, protein100:0, carbs100:0, fat100:100, densityGml:0.91, categoryId:'oil', popularity:100 
      } 
    },
    { 
      food: { 
        id:'fuzzy', name:'Olive Oil Alternative', brand:'OffBrand', source:'community', verification:'verified', 
        kcal100:884, protein100:0, carbs100:0, fat100:100, densityGml:0.91, categoryId:'oil', popularity:50 
      } 
    },
  ];
  const r = rankCandidates(cands as any, { query: 'olive oil', kcalBand: { min: 860, max: 900 } });
  expect(r[0].candidate.food.id).toBe('exact');
  expect(r[0].confidence).toBeGreaterThan(0.5);
});
