import { danger, fail, warn } from "danger";

const changed = danger.git.modified_files.concat(danger.git.created_files);
const parserTouched = changed.some(f => f.startsWith("src/lib/parse/"));
const testsTouched = changed.some(f =>
  f.startsWith("src/lib/parse/__tests__/") || f.endsWith(".test.ts")
);

if (parserTouched && !testsTouched) {
  fail("Parser code changed but no tests were updated/added.");
} else if (parserTouched) {
  warn("Parser changed — ensure eval still passes and perf is within budget.");
}

