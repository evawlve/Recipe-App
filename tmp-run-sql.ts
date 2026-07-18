import fs from 'fs';
import path from 'path';
import { prisma } from './src/lib/db';

async function main() {
  console.log('Reading fix-user-table.sql...');
  const sqlPath = path.join(__dirname, 'fix-user-table.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');

  console.log('Executing SQL statements on the database...');
  // Split statements by semicolon (simple splitter, works for this file)
  const statements = sql
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--'));

  for (let statement of statements) {
    // Re-add semicolon if omitted
    if (!statement.endsWith(';')) {
      statement += ';';
    }
    
    // Skip comments and empty statements
    if (statement.trim() === ';') continue;
    
    console.log(`Running statement:\n${statement.substring(0, 100)}...\n`);
    try {
      await prisma.$executeRawUnsafe(statement);
      console.log('✅ Success');
    } catch (err) {
      console.warn('⚠️ Statement warning/error (might be expected for triggers depending on privileges):', (err as Error).message);
    }
  }

  console.log('SQL Execution complete!');
}

main().catch(console.error).finally(() => prisma.$disconnect());
