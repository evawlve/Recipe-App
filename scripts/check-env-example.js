/**
 * Check .env.example parity
 * 
 * Ensures all environment variables referenced in code are documented in .env.example
 * 
 * Usage: node scripts/check-env-example.js
 */

const fs = require('fs');
const path = require('path');

// Common env var patterns
const envVarPattern = /process\.env\.([A-Z_][A-Z0-9_]*)/g;
const dotenvPattern = /([A-Z_][A-Z0-9_]*)\s*=/g;

function findEnvVarsInFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const vars = new Set();
  
  // Find process.env.VAR_NAME
  let match;
  while ((match = envVarPattern.exec(content)) !== null) {
    vars.add(match[1]);
  }
  
  return Array.from(vars);
}

function findEnvVarsInDir(dir, extensions = ['.ts', '.tsx', '.js', '.jsx']) {
  const vars = new Set();
  
  function walkDir(currentPath) {
    const entries = fs.readdirSync(currentPath, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);
      
      // Skip node_modules, .next, dist, etc.
      if (entry.isDirectory()) {
        if (!['node_modules', '.next', 'dist', '.git', 'coverage'].includes(entry.name)) {
          walkDir(fullPath);
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name);
        if (extensions.includes(ext)) {
          const fileVars = findEnvVarsInFile(fullPath);
          fileVars.forEach(v => vars.add(v));
        }
      }
    }
  }
  
  walkDir(dir);
  return Array.from(vars);
}

function getEnvExampleVars() {
  const envExamplePath = path.join(process.cwd(), '.env.example');
  
  if (!fs.existsSync(envExamplePath)) {
    console.warn('⚠️  .env.example not found');
    return new Set();
  }
  
  const content = fs.readFileSync(envExamplePath, 'utf8');
  const vars = new Set();
  
  // Find VAR_NAME= patterns
  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const match = trimmed.match(/^([A-Z_][A-Z0-9_]*)\s*=/);
      if (match) {
        vars.add(match[1]);
      }
    }
  }
  
  return vars;
}

function main() {
  console.log('🔍 Checking .env.example parity...\n');
  
  // Find all env vars used in code
  const codeVars = findEnvVarsInDir(path.join(process.cwd(), 'src'));
  console.log(`📊 Found ${codeVars.length} environment variables in code`);
  
  // Get vars documented in .env.example
  const exampleVars = getEnvExampleVars();
  console.log(`📄 Found ${exampleVars.size} variables in .env.example\n`);
  
  // Find missing vars
  const missing = codeVars.filter(v => !exampleVars.has(v));
  
  // Filter out common Node.js/system vars that don't need documentation
  const systemVars = ['NODE_ENV', 'PORT', 'PATH', 'HOME', 'USER', 'PWD'];
  const undocumented = missing.filter(v => !systemVars.includes(v));
  
  if (undocumented.length > 0) {
    console.error('❌ Missing environment variables in .env.example:');
    undocumented.forEach(v => {
      console.error(`   - ${v}`);
    });
    console.error('\n💡 Add these to .env.example with appropriate documentation');
    process.exit(1);
  } else {
    console.log('✅ All environment variables are documented in .env.example');
    process.exit(0);
  }
}

main();

