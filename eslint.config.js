import js from '@eslint/js';
import ts from 'typescript-eslint';
export default ts.config(
  { ignores: ['dist/**', 'node_modules/**', 'data/**'] },
  js.configs.recommended,
  ...ts.configs.recommended,
  { files: ['scripts/*.mjs'], languageOptions: { globals: { process: 'readonly' } } },
);
