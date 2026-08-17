import { parseMode } from '../../src/run-tests/mode';
import { InvalidInputError } from '../../src/lib/errors';

describe('parseMode', () => {
  it('accepts the customer-facing name', () => {
    expect(parseMode('ai-sdet')).toEqual({ mode: 'ai-sdet' });
  });

  it('still accepts the old autotest spelling', () => {
    // The path was called `autotest` before it had a customer-facing name.
    // Workflows in the wild still say that and the action is consumed through a
    // floating @v1, so dropping it would break pipelines on a tag nobody moved.
    expect(parseMode('autotest')).toEqual({
      mode: 'ai-sdet',
      aliasUsed: 'autotest',
    });
  });

  it('reports the alias so the caller can say it has been renamed', () => {
    expect(parseMode('autotest').aliasUsed).toBe('autotest');
    expect(parseMode('ai-sdet').aliasUsed).toBeUndefined();
  });

  it('defaults to gpt-driver when nothing is set', () => {
    expect(parseMode('')).toEqual({ mode: 'gpt-driver' });
  });

  it('is forgiving about case and padding', () => {
    expect(parseMode('  AI-SDET ').mode).toBe('ai-sdet');
    expect(parseMode('AutoTest').mode).toBe('ai-sdet');
  });

  it('names the valid values when given something else', () => {
    // The old name must not appear in the error: it still works, but it is not
    // what a new workflow should be told to write.
    expect(() => parseMode('pytest')).toThrow(InvalidInputError);
    expect(() => parseMode('pytest')).toThrow(/gpt-driver, ai-sdet/);
  });
});
