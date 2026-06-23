#!/usr/bin/env tsx
// Test if onion rings should be filtered

const candidateLower = "onion rings denny's".toLowerCase();
const queryLower = 'onion';
const startsWithQuery = candidateLower.startsWith(queryLower);

const PRODUCT_CATEGORIES = ['rings', 'ring', 'nuggets', 'bagel', 'bagels', 'bread'];
const isProduct = PRODUCT_CATEGORIES.some(cat => candidateLower.includes(cat));

console.log('Candidate:', candidateLower);
console.log('Query:', queryLower);
console.log('Starts with query:', startsWithQuery);
console.log('Is product:', isProduct);
console.log('');

// Logic: should reject because even though it starts with query, 
// the whole name includes a product category
console.log('Current logic: Start with query bypasses product check');
console.log('Needed logic: Product check should happen BEFORE starts-with');
