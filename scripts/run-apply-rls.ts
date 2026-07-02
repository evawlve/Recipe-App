import fs from 'fs';
import path from 'path';
import { prisma } from '../src/lib/db';

async function main() {
  console.log('Reading apply-rls.sql...');
  const sqlPath = path.join(__dirname, '../prisma/apply-rls.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');

  console.log('Executing SQL statements on the database...');
  // Split statements by semicolon, removing comments first
  const statements = sql
    .split(';')
    .map(s => {
      // Remove single-line comments (-- ...)
      return s
        .split('\n')
        .map(line => line.split('--')[0])
        .join('\n')
        .trim();
    })
    .filter(s => s.length > 0);

  let successCount = 0;
  let failCount = 0;

  for (let statement of statements) {
    // Re-add semicolon if omitted
    if (!statement.endsWith(';')) {
      statement += ';';
    }
    
    // Skip empty statements
    if (statement.trim() === ';') continue;
    
    console.log(`Running statement:\n${statement.substring(0, 120)}...\n`);
    try {
      await prisma.$executeRawUnsafe(statement);
      console.log('✅ Success');
      successCount++;
    } catch (err) {
      console.error('❌ Error executing statement:', (err as Error).message);
      failCount++;
    }
  }

  console.log('--------------------------------------------------');
  console.log(`SQL Execution complete! Success: ${successCount}, Failed: ${failCount}`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
