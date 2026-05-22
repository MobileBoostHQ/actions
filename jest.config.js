/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  clearMocks: true,
  collectCoverageFrom: ['src/**/*.ts', '!src/**/main.ts'],
  coverageDirectory: 'coverage',
  // ncc-bundled dist/ is committed output, never test it. (Don't add '/lib/'
  // here — it would also match the tests/lib/ source tree.)
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
  verbose: true,
};
