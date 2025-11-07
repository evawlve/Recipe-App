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

// Load baseline from main/master branch (if available)
// For now, we'll use a hardcoded baseline or compare against previous run
function getBaseline() {
  // In CI, we could fetch from main branch artifact
  // For now, use Sprint 0 baseline as reference
  return {
    pAt1: 47.0,  // Sprint 0 baseline
    mae: 114.9   // Sprint 0 baseline
  };
}

function main() {
  console.log('🔍 Checking eval gates...\n');
  
  const reportPath = findLatestEvalReport();
  console.log(`📄 Reading report: ${path.basename(reportPath)}\n`);
  
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  const baseline = getBaseline();
  
  // Extract metrics
  const currentPAt1 = report.metrics?.pAt1 || report.pAt1 || report.precisionAt1;
  const currentMAE = report.metrics?.mae || report.mae || report.meanAbsoluteError;
  
  if (currentPAt1 === undefined || currentMAE === undefined) {
    console.error('❌ Report missing required metrics (pAt1, mae)');
    console.error('Report structure:', JSON.stringify(report, null, 2));
    process.exit(1);
  }
  
  console.log('📊 Metrics:');
  console.log(`  P@1: ${currentPAt1.toFixed(2)}% (baseline: ${baseline.pAt1}%)`);
  console.log(`  MAE: ${currentMAE.toFixed(2)}g (baseline: ${baseline.mae}g)\n`);
  
  // Check gates
  const pAt1Drop = baseline.pAt1 - currentPAt1;
  const maeIncrease = currentMAE - baseline.maE;
  
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

