// Force Jest to use a WSL-writeable temp dir instead of the Windows Temp path.
process.env.TMPDIR = process.env.TMPDIR || '/tmp';

module.exports = {
  projects: [
    {
      displayName: 'api',
      cacheDirectory: '<rootDir>/tmp/jest-cache',
      testEnvironment: 'node',
      testMatch: [
        '<rootDir>/src/app/**/*.test.ts',
        '<rootDir>/src/lib/**/*.test.ts',
        '<rootDir>/src/ops/**/*.test.ts',
        // Eval/ops tooling under scripts/ was previously untestable, which is how the
        // abstention hole in run-eval.ts survived. F2's failure-class detectors are
        // required to be tested against their own exemplars, so they need this too.
        '<rootDir>/scripts/**/*.test.ts',
      ],
      transform: {
        '^.+\\.(ts|tsx)$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
      },
      moduleNameMapper: {
        '^@/(.*)$': '<rootDir>/src/$1',
      },
      // Blanks the provider credentials BEFORE any module is imported, so no test can
      // reach a live LLM. Must stay in `setupFiles`, not `setupFilesAfterEnv` — the
      // keys are captured into module-scope consts at import time. See the file.
      setupFiles: ['<rootDir>/jest.setup.no-llm.js'],
    },
    {
      displayName: 'components',
      cacheDirectory: '<rootDir>/tmp/jest-cache',
      testEnvironment: 'jsdom',
      testMatch: ['<rootDir>/src/components/**/*.test.tsx'],
      transform: {
        '^.+\\.(ts|tsx)$': ['ts-jest', { 
          tsconfig: '<rootDir>/tsconfig.json',
          useESM: false,
          isolatedModules: true
        }],
      },
      moduleNameMapper: {
        '^@/(.*)$': '<rootDir>/src/$1',
      },
      // Same gate as the `api` project: a component test can import the mapper chain
      // transitively, so the jsdom project needs it too.
      setupFiles: ['<rootDir>/jest.setup.no-llm.js'],
      setupFilesAfterEnv: ['<rootDir>/src/test-setup.ts'],
      extensionsToTreatAsEsm: ['.ts', '.tsx'],
      globals: {
        'ts-jest': {
          useESM: false
        }
      }
    },
  ],
};
