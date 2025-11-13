#!/usr/bin/env node
// Apply ESLint patch before loading ESLint
require('@rushstack/eslint-patch/modern-module-resolution');

const { ESLint } = require('eslint');
const path = require('path');
const fs = require('fs');
const glob = require('glob');

// Get the project root directory (where package.json is located)
let projectRoot = __dirname;
while (projectRoot && !fs.existsSync(path.join(projectRoot, 'package.json'))) {
  const parent = path.dirname(projectRoot);
  if (parent === projectRoot) break; // Reached filesystem root
  projectRoot = parent;
}

if (!fs.existsSync(path.join(projectRoot, 'package.json'))) {
  console.error('Error: Could not find package.json');
  process.exit(1);
}

// Find all files to lint
const patterns = [
  path.join(projectRoot, 'src', '**', '*.{js,jsx,ts,tsx}'),
  path.join(projectRoot, 'scripts', '**', '*.{js,ts}'),
  path.join(projectRoot, 'eval', '**', '*.{js,ts}'),
  path.join(projectRoot, 'prisma', '**', '*.{js,ts}'),
];

const files = [];
for (const pattern of patterns) {
  const matches = glob.sync(pattern, {
    cwd: projectRoot,
    absolute: true,
    ignore: ['**/node_modules/**', '**/.next/**', '**/dist/**'],
  });
  files.push(...matches);
}

// Create ESLint instance
const eslint = new ESLint({
  cwd: projectRoot,
  overrideConfigFile: path.join(projectRoot, 'eslint.config.cjs'),
});

// Lint files
(async () => {
  try {
    const results = await eslint.lintFiles(files);
    const formatter = await eslint.loadFormatter('stylish');
    const resultText = formatter.format(results);
    
    if (resultText) {
      console.log(resultText);
    }
    
    // Check for errors
    const hasErrors = results.some(result => result.errorCount > 0);
    process.exit(hasErrors ? 1 : 0);
  } catch (error) {
    console.error('ESLint error:', error.message);
    process.exit(1);
  }
})();

