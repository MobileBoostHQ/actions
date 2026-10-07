import { SkippedTest } from '../../src/lib/types';
import {
  reasonLabel,
  resolveSkipped,
  skippedWarnings,
} from '../../src/run-tests/skipped';

const skipped = (partial: Partial<SkippedTest>): SkippedTest => ({
  testId: 't1',
  title: 'Owner books a walk',
  platform: 'android',
  reason: 'not_automated',
  detail: '',
  ...partial,
});

describe('reasonLabel', () => {
  it.each([
    ['not_automated', 'Not automated yet'],
    ['generation_in_progress', 'Automation being generated'],
    ['generation_failed', 'Automation generation failed'],
    ['generation_blocked', 'Automation generation blocked'],
    ['not_ready', 'Not ready on this platform'],
  ])('names %s', (reason, label) => {
    expect(reasonLabel(reason)).toBe(label);
  });

  it('falls back to the backend wording for a reason it does not know', () => {
    expect(reasonLabel('waiting_for_review')).toBe('waiting for review');
    expect(reasonLabel('')).toBe('Not ready');
  });
});

describe('skippedWarnings', () => {
  it('says nothing when nothing was skipped', () => {
    expect(skippedWarnings({ skippedTests: [], warnings: [] })).toEqual([]);
  });

  it('passes the backend warnings through as they are', () => {
    const warnings = [
      '9 of 56 tests matching tags [owner-android] were not scheduled.',
    ];
    expect(skippedWarnings({ skippedTests: [skipped({})], warnings })).toEqual(
      warnings,
    );
  });

  it('summarises the skipped list when the backend sent no warning', () => {
    const [warning] = skippedWarnings({
      skippedTests: [
        skipped({}),
        skipped({ testId: 't2', title: '', reason: 'generation_failed' }),
      ],
      warnings: [],
    });
    expect(warning).toBe(
      '2 matched tests were not scheduled because they are not ready for ' +
        'automation yet: Owner books a walk (not automated yet), ' +
        't2 (automation generation failed). They do not affect the run result.',
    );
  });

  it('uses the singular for one test', () => {
    const [warning] = skippedWarnings({
      skippedTests: [skipped({})],
      warnings: [],
    });
    expect(warning).toMatch(/^1 matched test was not scheduled/);
  });
});

describe('resolveSkipped', () => {
  it('prefers the status endpoint once it reports skipped tests', () => {
    const fromStatus = [skipped({ testId: 'a' })];
    const fromTrigger = [skipped({ testId: 'b' })];
    expect(resolveSkipped(fromStatus, fromTrigger)).toBe(fromStatus);
  });

  it('falls back to the trigger answer on an older status endpoint', () => {
    const fromTrigger = [skipped({ testId: 'b' })];
    expect(resolveSkipped([], fromTrigger)).toBe(fromTrigger);
  });
});
