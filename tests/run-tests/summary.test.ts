import { RunStatus } from '../../src/lib/types';
import {
  buildAggregate,
  buildRows,
  buildRunUrl,
  buildSkippedRows,
  needsReviewAnnotation,
  needsReviewNote,
} from '../../src/run-tests/summary';

describe('buildRunUrl', () => {
  it('points at the run report page', () => {
    expect(buildRunUrl('8dcb3b1e51704221a0c0e31eb34f40ab')).toBe(
      'https://app.mobileboost.io/gpt-driver/reports/8dcb3b1e51704221a0c0e31eb34f40ab',
    );
  });
});

describe('buildRunUrl backends', () => {
  it('defaults to the gpt-driver dashboard', () => {
    expect(buildRunUrl('r1')).toBe(
      'https://app.mobileboost.io/gpt-driver/reports/r1',
    );
  });

  it('uses the gpt-driver dashboard for a QA Studio suite', () => {
    expect(buildRunUrl('r1', 'qa-studio')).toBe(
      'https://app.mobileboost.io/gpt-driver/reports/r1',
    );
  });

  it('uses the platform report host for a Platform run, whatever the mode', () => {
    expect(buildRunUrl('r1', 'platform')).toBe(
      'https://platform.mobileboost.io/reports/r1',
    );
  });
});

describe('buildAggregate', () => {
  const none = {
    succeededTests: [],
    failedTests: [],
    blockedTests: [],
    skippedTests: [],
  };

  it('reads as it always has when nothing was skipped', () => {
    expect(buildAggregate(none)).toBe(
      '✅ 0 passed&nbsp;&nbsp;&nbsp;❌ 0 failed&nbsp;&nbsp;&nbsp;⚠️ 0 blocked',
    );
  });

  it('adds the not scheduled count when tests were skipped', () => {
    const skippedTests = [
      {
        testId: 't1',
        title: 'A',
        platform: 'ios',
        reason: 'not_automated',
        detail: '',
      },
    ];
    expect(buildAggregate({ ...none, skippedTests })).toMatch(
      /⚠️ 0 blocked&nbsp;&nbsp;&nbsp;⏭️ 1 not scheduled$/,
    );
  });
});

describe('buildSkippedRows', () => {
  it('lists each skipped test with its platform and reason, escaped', () => {
    const rows = buildSkippedRows([
      {
        testId: 't1',
        title: 'Owner <books> a walk',
        platform: 'android',
        reason: 'generation_in_progress',
        detail: 'Automation for android is being generated.',
      },
      {
        testId: 't2',
        title: '',
        platform: '',
        reason: 'not_automated',
        detail: '',
      },
    ]);
    expect(rows).toHaveLength(3);
    expect(rows[1]).toEqual([
      'Owner &lt;books&gt; a walk',
      'android',
      'Automation being generated: Automation for android is being generated.',
    ]);
    expect(rows[2]).toEqual(['t2', '-', 'Not automated yet']);
  });
});

describe('needs review', () => {
  const review = {
    id: 'e3',
    title: 'Checkout with a promo code',
    status: 'needs_review',
    recording: 'https://platform.mobileboost.io/reports/r1/e3',
  };
  const run: RunStatus = {
    runId: 'r1',
    status: 'completed',
    totalTests: 2,
    succeededTests: [
      { id: 'e1', title: 'Log in', status: 'succeeded', recording: '' },
    ],
    failedTests: [],
    blockedTests: [],
    needsReviewTests: [review],
    skippedTests: [],
  };

  it('is counted in the tally only when there is one', () => {
    expect(buildAggregate(run)).toBe(
      '✅ 1 passed&nbsp;&nbsp;&nbsp;❌ 0 failed&nbsp;&nbsp;&nbsp;' +
        '⚠️ 0 blocked&nbsp;&nbsp;&nbsp;⚠️ 1 need review',
    );
    expect(buildAggregate({ ...run, needsReviewTests: [] })).not.toMatch(
      /need review/,
    );
    expect(buildAggregate({ ...run, needsReviewTests: undefined })).not.toMatch(
      /need review/,
    );
  });

  it('lists them after failures and before passes', () => {
    const rows = buildRows({
      ...run,
      failedTests: [
        { id: 'e2', title: 'Pay', status: 'failed', recording: '' },
      ],
    });
    expect(rows.slice(1).map((r) => r[1])).toEqual([
      'Pay',
      'Checkout with a promo code',
      'Log in',
    ]);
    expect(rows[2]?.[0]).toBe('⚠️');
  });

  it('annotates each one with its report link', () => {
    expect(needsReviewAnnotation(review)).toBe(
      '"Checkout with a promo code" needs review: the agent could not tell ' +
        'a broken test from an intended change in the app, so a person has ' +
        'to decide. Review it: https://platform.mobileboost.io/reports/r1/e3',
    );
    expect(needsReviewAnnotation({ ...review, title: '', recording: '' })).toBe(
      '"e3" needs review: the agent could not tell a broken test from an ' +
        'intended change in the app, so a person has to decide.',
    );
  });

  it('says in the summary whether they fail the job', () => {
    expect(needsReviewNote(run)).toMatch(/^> \*\*1 test needs review\.\*\*/);
    expect(needsReviewNote(run)).toMatch(/do not fail the job/);
    expect(needsReviewNote(run, true)).toMatch(
      /fail the job because `fail-on-needs-review` is on/,
    );
    expect(
      needsReviewNote({ needsReviewTests: [review, { ...review, id: 'e4' }] }),
    ).toMatch(/2 tests need review/);
    expect(needsReviewNote({ needsReviewTests: [] })).toBe('');
    expect(needsReviewNote({})).toBe('');
  });

  it('uses no em dashes in the new copy', () => {
    expect(needsReviewAnnotation(review)).not.toContain('\u2014');
    expect(needsReviewNote(run)).not.toContain('\u2014');
    expect(needsReviewNote(run, true)).not.toContain('\u2014');
  });
});
