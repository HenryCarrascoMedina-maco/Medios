/** Pruebas unitarias con Jest + jest-preset-angular (jsdom, sin navegador). */
/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-preset-angular',
  setupFilesAfterEnv: ['<rootDir>/src/setup-jest.ts'],
  testEnvironment: 'jsdom',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.spec.ts'],
  moduleNameMapper: {
    '^@core/(.*)$': '<rootDir>/src/app/core/$1',
    '^@shared/(.*)$': '<rootDir>/src/app/shared/$1'
  },
  transform: {
    '^.+\.(ts|js|mjs|html|svg)$': ['jest-preset-angular', { tsconfig: '<rootDir>/tsconfig.spec.json', stringifyContentPathRegex: '\.(html|svg)$' }]
  },
  transformIgnorePatterns: ['node_modules/(?!.*\.mjs$)'],
  clearMocks: true
};
