import { InvalidInputError } from '../../src/lib/errors';
import {
  parseBoolean,
  parseCsv,
  parseInteger,
  parseJsonArray,
  parseJsonObject,
} from '../../src/lib/validate';

describe('parseCsv', () => {
  it('splits, trims, and drops empties', () => {
    expect(parseCsv('a, b ,,c')).toEqual(['a', 'b', 'c']);
    expect(parseCsv('')).toEqual([]);
  });
});

describe('parseInteger', () => {
  it('parses integers', () => {
    expect(parseInteger('n', '3')).toBe(3);
    expect(parseInteger('n', ' -2 ')).toBe(-2);
  });
  it('rejects non-integers', () => {
    expect(() => parseInteger('n', '1.5')).toThrow(InvalidInputError);
    expect(() => parseInteger('n', 'x')).toThrow(/must be an integer/);
  });
});

describe('parseBoolean', () => {
  it('parses true/false case-insensitively', () => {
    expect(parseBoolean('b', 'true')).toBe(true);
    expect(parseBoolean('b', 'FALSE')).toBe(false);
  });
  it('rejects other values', () => {
    expect(() => parseBoolean('b', 'yes')).toThrow(InvalidInputError);
  });
});

describe('parseJsonObject', () => {
  it('parses an object', () => {
    expect(parseJsonObject('o', '{"a":1}')).toEqual({ a: 1 });
  });
  it('rejects arrays and invalid JSON', () => {
    expect(() => parseJsonObject('o', '[1,2]')).toThrow(/must be a JSON object/);
    expect(() => parseJsonObject('o', '{bad}')).toThrow(/not valid JSON/);
  });
});

describe('parseJsonArray', () => {
  it('parses an array', () => {
    expect(parseJsonArray('a', '[1,2]')).toEqual([1, 2]);
  });
  it('rejects objects', () => {
    expect(() => parseJsonArray('a', '{"a":1}')).toThrow(/must be a JSON array/);
  });
});
