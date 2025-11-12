import fs from 'fs';
import path from 'path';

interface EvalResult {
  id: string;
  raw_line: string;
  expected_food_name: string;
  expected_grams: number;
  top_food_name: string | null;
  resolved_grams: number | null;
  pAt1: number;
  mae: number;
  provisional: boolean;
}

interface EvalReport {
  gold: string;
  portionV2Enabled: boolean;
  timestamp: string;
  totals: { count: number };
  metrics: {
    pAt1: number;
    mae: number;
    provisionalRate: number;
  };
  samples: EvalResult[];
  allResults?: EvalResult[];
}

function analyzeReport(reportPath: string) {
  const content = fs.readFileSync(reportPath, 'utf8');
  const report: EvalReport = JSON.parse(content);
  
  const results = report.allResults || report.samples;
  const total = results.length;
  
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`Eval Analysis: ${report.gold}`);
  console.log(`Portion V2: ${report.portionV2Enabled ? '✅ ENABLED' : '❌ disabled'}`);
  console.log(`Timestamp: ${report.timestamp}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  console.log('📊 Overall Metrics:');
  console.log(`  Count: ${total}`);
  console.log(`  P@1: ${(report.metrics.pAt1 * 100).toFixed(1)}%`);
  console.log(`  MAE: ${report.metrics.mae.toFixed(1)}g`);
  console.log(`  Provisional: ${(report.metrics.provisionalRate * 100).toFixed(1)}%\n`);
  
  // Failures analysis
  const failures = results.filter(r => r.pAt1 === 0);
  const noMatch = failures.filter(r => r.top_food_name === null);
  const wrongMatch = failures.filter(r => r.top_food_name !== null);
  
  console.log('❌ Failures Breakdown:');
  console.log(`  Total failures: ${failures.length}/${total} (${(failures.length/total*100).toFixed(1)}%)`);
  console.log(`  No match found: ${noMatch.length}`);
  console.log(`  Wrong match: ${wrongMatch.length}\n`);
  
  // Top failures by MAE
  console.log('🔥 Top 20 Failures (by MAE):');
  console.log('─'.repeat(80));
  failures
    .sort((a, b) => b.mae - a.mae)
    .slice(0, 20)
    .forEach((f, idx) => {
      console.log(`${idx + 1}. [ID ${f.id}] "${f.raw_line}"`);
      console.log(`   Expected: ${f.expected_food_name} (${f.expected_grams}g)`);
      console.log(`   Got:      ${f.top_food_name || 'NO MATCH'} (${f.resolved_grams?.toFixed(1) || 0}g)`);
      console.log(`   MAE:      ${f.mae.toFixed(1)}g`);
      console.log('');
    });
  
  // Category analysis (extract patterns from failures)
  console.log('\n📋 Failure Patterns:');
  console.log('─'.repeat(80));
  
  const patterns = {
    'cooked vs raw': failures.filter(f => 
      f.raw_line.toLowerCase().includes('cooked') && 
      !f.top_food_name?.toLowerCase().includes('cooked')
    ),
    'specific cut/part': failures.filter(f => 
      /breast|thigh|wing|fillet|yolk|white/.test(f.raw_line.toLowerCase())
    ),
    'preparation qualifier': failures.filter(f => 
      /diced|chopped|sliced|minced|grated/.test(f.raw_line.toLowerCase())
    ),
    'brand/type mismatch': failures.filter(f => 
      f.top_food_name && f.top_food_name !== f.expected_food_name &&
      f.top_food_name.split(',')[0] === f.expected_food_name.split(',')[0]
    ),
    'wrong category': failures.filter(f => 
      f.top_food_name && 
      !f.top_food_name.toLowerCase().split(' ').some(word => 
        f.expected_food_name.toLowerCase().split(' ').includes(word)
      )
    ),
  };
  
  Object.entries(patterns).forEach(([pattern, cases]) => {
    if (cases.length > 0) {
      console.log(`\n${pattern}: ${cases.length} cases`);
      cases.slice(0, 3).forEach(c => {
        console.log(`  • [${c.id}] "${c.raw_line}"`);
        console.log(`    Expected: ${c.expected_food_name}`);
        console.log(`    Got:      ${c.top_food_name || 'NO MATCH'}`);
      });
      if (cases.length > 3) {
        console.log(`  ... and ${cases.length - 3} more`);
      }
    }
  });
  
  // Save detailed failure report
  const failureReport = {
    summary: {
      total: total,
      failures: failures.length,
      failureRate: failures.length / total,
      noMatch: noMatch.length,
      wrongMatch: wrongMatch.length,
    },
    patterns: Object.fromEntries(
      Object.entries(patterns).map(([name, cases]) => [name, cases.length])
    ),
    allFailures: failures.map(f => ({
      id: f.id,
      raw_line: f.raw_line,
      expected_food_name: f.expected_food_name,
      expected_grams: f.expected_grams,
      top_food_name: f.top_food_name,
      resolved_grams: f.resolved_grams,
      mae: f.mae,
      provisional: f.provisional,
    })),
  };
  
  const failureReportPath = reportPath.replace('.json', '-failures.json');
  fs.writeFileSync(failureReportPath, JSON.stringify(failureReport, null, 2), 'utf8');
  console.log(`\n✅ Detailed failure report saved to: ${path.basename(failureReportPath)}`);
}

// Main
const args = process.argv.slice(2);
if (args.length === 0) {
  // Find most recent report
  const reportsDir = path.join(process.cwd(), 'reports');
  const files = fs.readdirSync(reportsDir)
    .filter(f => f.startsWith('eval-') && f.endsWith('.json') && !f.includes('failures'))
    .map(f => ({
      name: f,
      path: path.join(reportsDir, f),
      mtime: fs.statSync(path.join(reportsDir, f)).mtime
    }))
    .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
  
  if (files.length === 0) {
    console.error('No eval reports found in reports/ directory');
    console.error('Run `npm run eval` first to generate a report');
    process.exit(1);
  }
  
  console.log(`Analyzing most recent report: ${files[0].name}\n`);
  analyzeReport(files[0].path);
} else {
  // Analyze specified report
  const reportPath = path.join(process.cwd(), 'reports', args[0]);
  if (!fs.existsSync(reportPath)) {
    console.error(`Report not found: ${reportPath}`);
    process.exit(1);
  }
  analyzeReport(reportPath);
}

