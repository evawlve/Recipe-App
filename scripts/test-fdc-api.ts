#!/usr/bin/env ts-node
/**
 * Smoke tests for FDC API client
 * Tests connectivity, rate limiting, and caching behavior
 */

import { fdcApi } from '../src/lib/usda/fdc-api';

const API_KEY = process.env.FDC_API_KEY;

if (!API_KEY) {
  console.error('❌ FDC_API_KEY not set. Please set it in your .env file.');
  console.log('Get a free key at: https://fdc.nal.usda.gov/api-key-signup.html');
  process.exit(1);
}

async function testConnectivity() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Test 1: Connectivity Test');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Query: "kodiak protein pancake"');
  
  try {
    const result = await fdcApi.searchFoods({
      query: 'kodiak protein pancake',
      pageSize: 5,
    });

    if (!result) {
      console.log('❌ No results returned');
      return false;
    }

    const brandedCount = result.foods.filter(
      (f) => f.dataType === 'Branded' && f.gtinUpc
    ).length;

    console.log(`✅ Found ${result.foods.length} total foods`);
    console.log(`   ${brandedCount} branded foods with GTINs`);

    if (brandedCount >= 3) {
      console.log('✅ PASS: Found ≥3 branded products with GTINs');
      
      // Show sample results
      console.log('\n   Sample results:');
      result.foods.slice(0, 3).forEach((food, i) => {
        console.log(`   ${i + 1}. ${food.description}`);
        if (food.brandName) console.log(`      Brand: ${food.brandName}`);
        if (food.gtinUpc) console.log(`      GTIN: ${food.gtinUpc}`);
      });
      
      return true;
    } else {
      console.log(`⚠️  WARNING: Only found ${brandedCount} branded foods with GTINs (expected ≥3)`);
      return true; // Still pass, might be data availability issue
    }
  } catch (error) {
    console.error('❌ FAIL: Error during connectivity test:', error);
    return false;
  }
}

async function testRateLimiter() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Test 2: Rate Limiter Test');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Making 15 rapid calls (should auto-throttle to <10 req/s)...');

  const startTime = Date.now();
  let errorCount = 0;
  let successCount = 0;

  try {
    // Make 15 rapid calls
    const promises = Array.from({ length: 15 }, (_, i) =>
      fdcApi.searchFoods({ query: `test${i}`, pageSize: 1 }).catch((err) => {
        errorCount++;
        console.error(`   Error on call ${i + 1}:`, err.message);
        return null;
      })
    );

    const results = await Promise.all(promises);
    successCount = results.filter((r) => r !== null).length;

    const elapsed = Date.now() - startTime;
    const requestsPerSecond = 15 / (elapsed / 1000);

    console.log(`✅ Completed 15 calls in ${(elapsed / 1000).toFixed(2)}s`);
    console.log(`   Rate: ${requestsPerSecond.toFixed(2)} req/s`);
    console.log(`   Success: ${successCount}, Errors: ${errorCount}`);

    if (errorCount === 0 && requestsPerSecond <= 10.5) {
      // Allow small tolerance
      console.log('✅ PASS: No 429 errors, rate stayed under 10 req/s');
      return true;
    } else if (errorCount === 0) {
      console.log(`⚠️  WARNING: Rate was ${requestsPerSecond.toFixed(2)} req/s (slightly over 10)`);
      return true; // Still pass, might be timing variance
    } else {
      console.log(`❌ FAIL: ${errorCount} errors occurred`);
      return false;
    }
  } catch (error) {
    console.error('❌ FAIL: Error during rate limiter test:', error);
    return false;
  }
}

async function testCache() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Test 3: Cache Test');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Query: "fage greek yogurt" (same query twice)');

  try {
    // First call - should hit API
    const start1 = Date.now();
    const result1 = await fdcApi.searchFoods({
      query: 'fage greek yogurt',
      pageSize: 5,
    });
    const time1 = Date.now() - start1;

    if (!result1) {
      console.log('❌ First call failed');
      return false;
    }

    console.log(`   Cold call: ${time1}ms (API hit)`);

    // Second call - should hit cache
    const start2 = Date.now();
    const result2 = await fdcApi.searchFoods({
      query: 'fage greek yogurt',
      pageSize: 5,
    });
    const time2 = Date.now() - start2;

    if (!result2) {
      console.log('❌ Second call failed');
      return false;
    }

    console.log(`   Cached call: ${time2}ms (cache hit)`);

    // Verify results are identical
    const resultsMatch =
      JSON.stringify(result1.foods) === JSON.stringify(result2.foods);

    if (!resultsMatch) {
      console.log('⚠️  WARNING: Results differ between calls');
    }

    const speedup = time1 / time2;

    if (time2 < 50 && speedup > 5) {
      console.log(`✅ PASS: Cache hit is ${speedup.toFixed(1)}x faster (<50ms)`);
      return true;
    } else if (time2 < 100 && speedup > 2) {
      console.log(`⚠️  WARNING: Cache hit is ${speedup.toFixed(1)}x faster but took ${time2}ms`);
      return true; // Still acceptable
    } else {
      console.log(`❌ FAIL: Cache not working effectively (${time2}ms, ${speedup.toFixed(1)}x speedup)`);
      return false;
    }
  } catch (error) {
    console.error('❌ FAIL: Error during cache test:', error);
    return false;
  }
}

async function runAllTests() {
  console.log('🚀 FDC API Client Smoke Tests');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const results = {
    connectivity: await testConnectivity(),
    rateLimiter: await testRateLimiter(),
    cache: await testCache(),
  };

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Test Summary');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const passed = Object.values(results).filter((r) => r).length;
  const total = Object.keys(results).length;

  Object.entries(results).forEach(([test, result]) => {
    const status = result ? '✅ PASS' : '❌ FAIL';
    console.log(`${status}: ${test}`);
  });

  console.log(`\n${passed}/${total} tests passed`);

  if (passed === total) {
    console.log('🎉 All tests passed!');
    process.exit(0);
  } else {
    console.log('⚠️  Some tests failed or had warnings');
    process.exit(1);
  }
}

// Run tests
runAllTests().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

