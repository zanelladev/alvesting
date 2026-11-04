import base from '@alvesting/config/eslint';
import nextVitals from 'eslint-config-next/core-web-vitals';

const config = [
  ...base,
  ...nextVitals,
  { languageOptions: { parserOptions: { tsconfigRootDir: import.meta.dirname } } },
];

export default config;
