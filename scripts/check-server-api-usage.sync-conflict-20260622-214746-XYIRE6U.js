const { globby } = require('globby');
const fs = require('fs');

(async () => {
  try {
    const files = await globby(['src/app/**/*.{ts,tsx}', '!**/*.client.{ts,tsx}']);
    const offenders = [];
    
    for (const f of files) {
      const c = fs.readFileSync(f, 'utf8');
      if (!c.includes("'use client'") && c.match(/fetch\\(['"`]\\s*\\/api\\//)) {
        offenders.push(f);
      }
    }
    
    if (offenders.length) {
      console.error('Server files calling /api detected:\\n' + offenders.join('\n'));
      process.exit(1);
    } else {
      console.log('✅ No server-side API calls detected');
    }
  } catch (error) {
    console.error('Error checking server API usage:', error);
    process.exit(1);
  }
})();
