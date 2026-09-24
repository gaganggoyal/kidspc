import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

/**
 * Lint rules are limited to things a reviewer would otherwise have to catch by
 * hand. Formatting belongs to Prettier, and type errors belong to `tsc` -- so
 * neither is duplicated here.
 */
export default tseslint.config(
  { ignores: ['**/dist/**', '**/dist-ssr/**', '**/node_modules/**', '**/.data/**', '*.tmp.ts', 'tools/video/.render/**', 'tools/video/.capture/**'] },
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
  // Build scripts run in Node, where URL and console are globals.
  {
    files: ['**/scripts/**/*.mjs', 'tools/video/**/*.mjs'],
    languageOptions: {
      globals: {
        URL: 'readonly',
        console: 'readonly',
        process: 'readonly',
        setTimeout: 'readonly',
        fetch: 'readonly',
        Buffer: 'readonly',
      },
    },
  },
  {
    files: ['**/*.test.ts'],
    rules: { '@typescript-eslint/no-non-null-assertion': 'off' },
  },
  /*
   * Two rules, on the components only. Both catch the same class of bug: a
   * value that a hook depends on but was never told about, or an identity that
   * changes on every render so a dependency list means nothing. Reading for
   * that by hand is exactly what a reviewer is worst at, and both of the timing
   * defects fixed in this pass were of that kind.
   */
  {
    files: ['apps/web/src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
  },
);
