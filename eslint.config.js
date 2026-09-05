import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Lint rules are limited to things a reviewer would otherwise have to catch by
 * hand. Formatting belongs to Prettier, and type errors belong to `tsc` -- so
 * neither is duplicated here.
 */
export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/.data/**', '*.tmp.ts'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // Deliberate: `catch {}` around best-effort cleanup is a pattern here,
      // and the empty block is the point.
      'no-empty': ['error', { allowEmptyCatch: true }],
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
  {
    files: ['**/*.test.ts'],
    rules: { '@typescript-eslint/no-non-null-assertion': 'off' },
  },
);
