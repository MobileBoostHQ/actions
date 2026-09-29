import { buildRunUrl } from '../../src/run-tests/summary';

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
