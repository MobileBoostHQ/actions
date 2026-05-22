import { InvalidInputError } from './errors';

/** Comma-separated string -> trimmed, non-empty items. */
export function parseCsv(value: string): string[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function parseInteger(name: string, value: string): number {
  const trimmed = value.trim();
  if (!/^-?\d+$/.test(trimmed)) {
    throw new InvalidInputError(
      `\`${name}\` must be an integer, got "${value}".`,
    );
  }
  return parseInt(trimmed, 10);
}

export function parseBoolean(name: string, value: string): boolean {
  const v = value.trim().toLowerCase();
  if (v === 'true') return true;
  if (v === 'false') return false;
  throw new InvalidInputError(
    `\`${name}\` must be "true" or "false", got "${value}".`,
  );
}

export function parseJsonObject(
  name: string,
  value: string,
): Record<string, unknown> {
  const parsed = parseJsonOrThrow(name, value);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new InvalidInputError(`\`${name}\` must be a JSON object.`);
  }
  return parsed as Record<string, unknown>;
}

export function parseJsonArray(name: string, value: string): unknown[] {
  const parsed = parseJsonOrThrow(name, value);
  if (!Array.isArray(parsed)) {
    throw new InvalidInputError(`\`${name}\` must be a JSON array.`);
  }
  return parsed;
}

function parseJsonOrThrow(name: string, value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new InvalidInputError(`\`${name}\` is not valid JSON: ${reason}`);
  }
}
