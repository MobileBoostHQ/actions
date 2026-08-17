import { buildRunUrl } from '../../src/run-tests/summary';

describe('buildRunUrl', () => {
  it('points at the run report page', () => {
    expect(buildRunUrl('8dcb3b1e51704221a0c0e31eb34f40ab')).toBe(
      'https://app.mobileboost.io/gpt-driver/reports/8dcb3b1e51704221a0c0e31eb34f40ab',
    );
  });
});

describe('buildRunUrl modes', () => {
  it('defaults to the gpt-driver dashboard', () => {
    expect(buildRunUrl('r1')).toBe(
      'https://app.mobileboost.io/gpt-driver/reports/r1',
    );
  });

  it('uses the platform report host for autotest runs', () => {
    expect(buildRunUrl('r1', 'ai-sdet')).toBe(
      'https://platform.mobileboost.io/reports/r1',
    );
  });
});
