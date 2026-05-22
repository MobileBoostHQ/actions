import { buildRunUrl } from '../../src/run-tests/summary';

describe('buildRunUrl', () => {
  it('points at the run report page', () => {
    expect(buildRunUrl('8dcb3b1e51704221a0c0e31eb34f40ab')).toBe(
      'https://app.mobileboost.io/gpt-driver/reports/8dcb3b1e51704221a0c0e31eb34f40ab',
    );
  });
});
