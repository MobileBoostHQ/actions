import { SkippedTest, TriggerResult } from '../lib/types';

/**
 * Plain-language name for why a test is not in the run. Unknown reasons fall
 * back to the backend's own wording rather than to a guess.
 */
export function reasonLabel(reason: string): string {
  switch (reason) {
    case 'not_automated':
      return 'Not automated yet';
    case 'generation_in_progress':
      return 'Automation being generated';
    case 'generation_failed':
      return 'Automation generation failed';
    case 'generation_blocked':
      return 'Automation generation blocked';
    case 'not_ready':
      return 'Not ready on this platform';
    default:
      return reason ? reason.replace(/_/g, ' ') : 'Not ready';
  }
}

/**
 * The warnings to annotate the workflow with after a trigger. The backend's
 * own sentences when it sent some, since it knows the selection that matched;
 * otherwise one summary built from the skipped list, so a backend that only
 * sends the list still gets noticed in the run log.
 */
export function skippedWarnings(
  result: Pick<TriggerResult, 'skippedTests' | 'warnings'>,
): string[] {
  if (result.warnings.length > 0) return result.warnings;
  const skipped = result.skippedTests;
  if (skipped.length === 0) return [];
  const names = skipped.map(describe).join(', ');
  const noun = skipped.length === 1 ? 'test was' : 'tests were';
  return [
    `${skipped.length} matched ${noun} not scheduled because they are not ` +
      `ready for automation yet: ${names}. They do not affect the run result.`,
  ];
}

/**
 * The skipped tests to report for a finished run. The status endpoint is the
 * record once it carries them; an older backend that only answered them on the
 * trigger still has them reported, from the trigger.
 */
export function resolveSkipped(
  fromStatus: SkippedTest[],
  fromTrigger: SkippedTest[],
): SkippedTest[] {
  return fromStatus.length > 0 ? fromStatus : fromTrigger;
}

function describe(test: SkippedTest): string {
  const name = test.title || test.testId || '(untitled)';
  return `${name} (${reasonLabel(test.reason).toLowerCase()})`;
}
