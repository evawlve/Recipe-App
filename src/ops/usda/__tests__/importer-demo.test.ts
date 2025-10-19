import { importUsdaGenerics } from '../importer';
import { canonicalizeName, macroFingerprint, generateAliases } from '../dedupe';

// Mock Prisma
const mockPrisma = {
  food: {
    findFirst: jest.fn(),
    create: jest.fn(),
  },
  foodAlias: {
    create: jest.fn(),
  },
  foodUnit: {
    create: jest.fn(),
  }
};

jest.mock('../../../lib/db', () => ({
  prisma: mockPrisma
}));

// Mock logger
jest.mock('../../../lib/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn()
  }
}));

describe('USDA Importer Demo', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('demo: deduplication logic', () => {
    console.log('=== Deduplication Demo ===');
    
    // Test canonicalization
    const name1 = 'Olive Oil (Extra Virgin)';
    const name2 = 'olive oil, extra virgin';
    const canonical1 = canonicalizeName(name1);
    const canonical2 = canonicalizeName(name2);
    
    console.log(`Original: "${name1}" -> Canonical: "${canonical1}"`);
    console.log(`Original: "${name2}" -> Canonical: "${canonical2}"`);
    console.log(`Match: ${canonical1 === canonical2}`);
    
    expect(canonical1).toBe(canonical2);
    
    // Test macro fingerprint
    const finger1 = macroFingerprint(884, 0, 0, 100); // Olive oil
    const finger2 = macroFingerprint(884, 0, 0, 100); // Same olive oil
    const finger3 = macroFingerprint(717, 0.9, 0.1, 81); // Butter
    
    console.log(`Olive oil fingerprint: ${finger1}`);
    console.log(`Same olive oil fingerprint: ${finger2}`);
    console.log(`Butter fingerprint: ${finger3}`);
    console.log(`Olive oil match: ${finger1 === finger2}`);
    console.log(`Butter different: ${finger1 !== finger3}`);
    
    expect(finger1).toBe(finger2);
    expect(finger1).not.toBe(finger3);
    
    // Test alias generation
    const aliases = generateAliases('Chicken Breast');
    console.log(`Aliases for "Chicken Breast": ${aliases.join(', ')}`);
    
    expect(aliases).toContain('chicken breast');
    expect(aliases).toContain('chicken breasts');
    expect(aliases).toContain('chicken breast raw');
    expect(aliases).toContain('chicken breast cooked');
  });

  test('demo: import process', async () => {
    console.log('=== Import Process Demo ===');
    
    // Mock no duplicates found
    mockPrisma.food.findFirst.mockResolvedValue(null);
    mockPrisma.food.create.mockResolvedValue({ id: 'food_123' });
    mockPrisma.foodAlias.create.mockResolvedValue({ id: 'alias_123' });
    mockPrisma.foodUnit.create.mockResolvedValue({ id: 'unit_123' });
    
    const sampleRows = [
      {
        id: 1,
        description: 'Olive Oil',
        nutrients: {
          kcal: 884,
          protein: 0,
          carbs: 0,
          fat: 100,
          fiber: 0,
          sugar: 0
        }
      },
      {
        id: 2,
        description: 'Chicken Breast, Raw',
        nutrients: {
          kcal: 165,
          protein: 31,
          carbs: 0,
          fat: 3.6,
          fiber: 0,
          sugar: 0
        }
      },
      {
        id: 3,
        description: 'All-Purpose Flour',
        nutrients: {
          kcal: 364,
          protein: 10,
          carbs: 76,
          fat: 1,
          fiber: 3,
          sugar: 1
        }
      }
    ];
    
    const result = await importUsdaGenerics(sampleRows, { dryRun: false });
    
    console.log(`Import result: ${result.created} created, ${result.skipped} skipped, ${result.errors} errors`);
    
    expect(result.created).toBe(3);
    expect(result.skipped).toBe(0);
    expect(result.errors).toBe(0);
    
    // Verify food creation calls
    expect(mockPrisma.food.create).toHaveBeenCalledTimes(3);
    
    // Verify alias creation calls
    expect(mockPrisma.foodAlias.create).toHaveBeenCalled();
    
    // Verify unit creation calls
    expect(mockPrisma.foodUnit.create).toHaveBeenCalled();
    
    console.log('✅ Import process working correctly');
  });

  test('demo: duplicate detection', async () => {
    console.log('=== Duplicate Detection Demo ===');
    
    // Mock duplicate found
    mockPrisma.food.findFirst.mockResolvedValue({ id: 'existing_food' });
    
    const duplicateRows = [
      {
        id: 1,
        description: 'Olive Oil',
        nutrients: {
          kcal: 884,
          protein: 0,
          carbs: 0,
          fat: 100,
          fiber: 0,
          sugar: 0
        }
      }
    ];
    
    const result = await importUsdaGenerics(duplicateRows, { dryRun: false });
    
    console.log(`Duplicate detection result: ${result.created} created, ${result.skipped} skipped`);
    
    expect(result.created).toBe(0);
    expect(result.skipped).toBe(1);
    
    // Verify no food creation
    expect(mockPrisma.food.create).not.toHaveBeenCalled();
    
    console.log('✅ Duplicate detection working correctly');
  });
});
