import { danger, fail, warn } from "danger";

const changed = danger.git.modified_files.concat(danger.git.created_files);
// Exclude test files from parser detection to avoid false positives
const parserTouched = changed.some(
  f =>
    f.startsWith("src/lib/parse/") &&
    !f.startsWith("src/lib/parse/__tests__/") &&
    !f.endsWith(".test.ts")
);
const testsTouched = changed.some(f =>
  f.startsWith("src/lib/parse/__tests__/") || f.endsWith(".test.ts")
);

if (parserTouched && !testsTouched) {
  fail("Parser code changed but no tests were updated/added.");
} else if (parserTouched) {
  warn("Parser changed — ensure eval still passes and perf is within budget.");
}

