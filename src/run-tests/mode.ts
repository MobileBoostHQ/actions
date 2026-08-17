import { InvalidInputError } from '../lib/errors';
import { RunMode } from './summary';

export const RUN_MODES: RunMode[] = ['gpt-driver', 'ai-sdet'];

/**
 * Spellings kept working after a rename.
 *
 * The AI SDET path was called `autotest` before it had a customer-facing name.
 * Workflows in the wild still say that, and the action is consumed through a
 * floating `@v1`, so removing the old spelling would break pipelines on a tag
 * nobody chose to move.
 */
export const MODE_ALIASES: Record<string, RunMode> = { autotest: 'ai-sdet' };

export function parseMode(raw: string): { mode: RunMode; aliasUsed?: string } {
  const value = (raw || 'gpt-driver').trim().toLowerCase();

  const aliased = MODE_ALIASES[value];
  if (aliased) return { mode: aliased, aliasUsed: value };

  if (!RUN_MODES.includes(value as RunMode)) {
    throw new InvalidInputError(
      `Invalid \`mode\`: "${raw}". Expected one of: ${RUN_MODES.join(', ')}.`,
    );
  }
  return { mode: value as RunMode };
}
