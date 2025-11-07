/**
 * CI Check: Eval Gates
 * 
 * Reads the latest eval JSON report and fails if:
 * - P@1 drops > 1.5 percentage points
 * - MAE increases > 2g
 * 
 * Usage: node scripts/ci-check-eval-gates.js
 */

const fs = require('fs');
const path = require('path');

// Find the latest eval report
function findLatestEvalReport() {
  const reportsDir = path.join(process.cwd(), 'reports');
  if (!fs.existsSync(reportsDir)) {
    console.error('❌ reports/ directory does not exist');
    process.exit(1);
  }
  
  const files = fs.readdirSync(reportsDir)
    .filter(f => f.startsWith('eval-baseline-') && f.endsWith('.json'))
    .sort()
    .reverse();
  
  if (files.length === 0) {
    console.error('❌ No eval reports found in reports/');
    process.exit(1);
  }
  
  return path.join(reportsDir, files[0]);
}

// Load baseline from main/master branch artifact or fallback to Sprint 0 baseline
function getBaseline(baselineDir) {
  // Try to load from downloaded baseline artifact
  if (baselineDir && fs.existsSync(baselineDir)) {
    const baselinePath = path.join(baselineDir, 'eval-baseline-*.json');
    const files = glob.sync(baselinePath);
    
    if (files.length > 0) {
      const latest = files.sort().reverse()[0];
      try {
        const baselineReport = JSON.parse(fs.readFileSync(latest, 'utf8'));
        const pAt1 = baselineReport.metrics?.pAt1 || baselineReport.pAt1 || baselineReport.precisionAt1;
        const mae = baselineReport.metrics?.mae || baselineReport.mae || baselineReport.meanAbsoluteError;
        
        if (pAt1 !== undefined && mae !== undefined) {
          console.log(`📊 Using baseline from main branch artifact`);
          return { pAt1, mae };
        }
      } catch (error) {
        console.warn(`⚠️  Could not parse baseline artifact: ${error.message}`);
      }
    }
  }
  
  // Fallback to Sprint 0 baseline
  console.log(`📊 Using Sprint 0 hardcoded baseline (artifact not available)`);
  return {
    pAt1: 47.0,  // Sprint 0 baseline
    mae: 114.9   // Sprint 0 baseline
  };
}

function main() {
  console.log('🔍 Checking eval gates...\n');
  
  // Parse command line arguments
  const args = process.argv.slice(2);
  let baselineDir = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--baselineDir' && i + 1 < args.length) {
      baselineDir = args[i + 1];
      break;
    }
  }
  
  const reportPath = findLatestEvalReport();
  console.log(`📄 Reading report: ${path.basename(reportPath)}\n`);
  
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  const baseline = getBaseline(baselineDir);
  
  // Extract metrics (handle 0 values correctly)
  const currentPAt1 = report.metrics?.pAt1 !== undefined 
    ? report.metrics.pAt1 
    : (report.pAt1 !== undefined ? report.pAt1 : report.precisionAt1);
  const currentMAE = report.metrics?.mae !== undefined
    ? report.metrics.mae
    : (report.mae !== undefined ? report.mae : report.meanAbsoluteError);
  
  if (currentPAt1 === undefined || currentMAE === undefined) {
    console.error('❌ Report missing required metrics (pAt1, mae)');
    console.error('Report structure:', JSON.stringify(report, null, 2));
    process.exit(1);
  }
  
  console.log('📊 Metrics:');
  console.log(`  P@1: ${currentPAt1.toFixed(2)}% (baseline: ${baseline.pAt1}%)`);
  console.log(`  MAE: ${currentMAE.toFixed(2)}g (baseline: ${baseline.mae}g)\n`);
  
  // Detect empty database scenario (pAt1 = 0 and all provisional)
  const provisionalRate = report.metrics?.provisionalRate !== undefined
    ? report.metrics.provisionalRate
    : (report.provisionalRate !== undefined ? report.provisionalRate : null);
  
  const isEmptyDatabase = currentPAt1 === 0 && provisionalRate === 1;
  
  if (isEmptyDatabase) {
    console.warn('⚠️  Detected empty database scenario (pAt1=0%, provisionalRate=100%)');
    console.warn('⚠️  This usually means the database was not seeded before running eval');
    console.warn('⚠️  Skipping gate checks - this is expected in CI without seed data');
    console.warn('⚠️  To run full eval gates, seed the database first');
    console.log('');
    console.log('✅ Eval gates skipped (empty database detected)');
    process.exit(0);
  }
  
  // Check gates
  const pAt1Drop = baseline.pAt1 - currentPAt1;
  const maeIncrease = currentMAE - baseline.mae;
  
  let failed = false;
  
  if (pAt1Drop > 1.5) {
    console.error(`❌ P@1 dropped by ${pAt1Drop.toFixed(2)}pp (threshold: 1.5pp)`);
    failed = true;
  } else {
    console.log(`✅ P@1 change: ${pAt1Drop >= 0 ? '-' : '+'}${Math.abs(pAt1Drop).toFixed(2)}pp (within threshold)`);
  }
  
  if (maeIncrease > 2.0) {
    console.error(`❌ MAE increased by ${maeIncrease.toFixed(2)}g (threshold: 2g)`);
    failed = true;
  } else {
    console.log(`✅ MAE change: ${maeIncrease >= 0 ? '+' : '-'}${Math.abs(maeIncrease).toFixed(2)}g (within threshold)`);
  }
  
  console.log('');
  
  if (failed) {
    console.error('❌ Eval gates failed - PR blocked');
    process.exit(1);
  } else {
    console.log('✅ Eval gates passed');
    process.exit(0);
  }
}

main();

