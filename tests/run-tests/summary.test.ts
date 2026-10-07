import {
  buildAggregate,
  buildRunUrl,
  buildSkippedRows,
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
