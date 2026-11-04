import js from '@eslint/js';
import tseslint from 'typescript-eslint';

// Cada pacote reexporta esta lista no seu eslint.config.mjs e informa o tsconfigRootDir.
export default [
  {
    ignores: ['dist/**', '.next/**', 'coverage/**', 'src/generated/**', 'next-env.d.ts'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: { parserOptions: { projectService: true } },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  // arquivos .mjs/.js (configs) não passam pelo type-check
  { files: ['**/*.{js,mjs,cjs}'], ...tseslint.configs.disableTypeChecked },
];
