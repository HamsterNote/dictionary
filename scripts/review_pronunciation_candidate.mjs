import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { buildCandidate, candidateMarkdown, verifyApproval } from './pronunciation_publication.mjs';

try {
  const { values } = parseArgs({
    options: {
      input: { type: 'string' },
      candidate: { type: 'string' },
      report: { type: 'string' },
      approval: { type: 'string' },
      baseline: { type: 'string' },
    },
  });
  if (!values.input || !values.candidate || !values.report)
    throw new Error(
      'Required: --input current-input.json --candidate candidate.json --report report.md [--approval approval.json --baseline manifest-version]',
    );
  const candidate = buildCandidate(JSON.parse(readFileSync(values.input, 'utf8')));
  writeFileSync(values.candidate, JSON.stringify(candidate, null, 2) + '\n');
  writeFileSync(values.report, candidateMarkdown(candidate));
  console.log(`Candidate SHA256: ${candidate.candidateHash}; no publication performed`);
  if (values.approval) {
    if (!values.baseline) throw new Error('--baseline is required when checking an approval');
    verifyApproval(candidate, JSON.parse(readFileSync(values.approval, 'utf8')), values.baseline);
    console.log(
      'Explicit approval matches current candidate and baseline; this command does not publish',
    );
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 2;
}
