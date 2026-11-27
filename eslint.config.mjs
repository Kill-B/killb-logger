import { node } from '@killb/code-style/eslint';
import { defineConfig } from 'eslint/config';

export default defineConfig(
  node({ ignores: ['dist/**', 'test/consumers/*/**'], tsconfigRootDir: import.meta.dirname }),
  {
    // node:test's describe and it return promises the runner already tracks.
    files: ['test/**/*.ts'],
    rules: { '@typescript-eslint/no-floating-promises': 'off' },
  },
);
