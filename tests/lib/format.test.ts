import { formatBytes, formatDuration } from '../../src/lib/format';

describe('formatBytes', () => {
  it('formats sizes across units', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
    expect(formatBytes(5.5 * 1024 * 1024 * 1024)).toBe('5.5 GB');
  });
  it('handles invalid input', () => {
    expect(formatBytes(-1)).toBe('0 B');
    expect(formatBytes(NaN)).toBe('0 B');
  });
});

describe('formatDuration', () => {
  it('formats durations', () => {
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(5000)).toBe('5s');
    expect(formatDuration(65_000)).toBe('1m 5s');
    expect(formatDuration(3_661_000)).toBe('1h 1m 1s');
  });
});
