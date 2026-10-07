import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**', 'jesus-ia-ideacao.md'] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    // Cena 3D: o padrão do React Three Fiber é mudar objetos do Three.js (materiais, uniforms, posições)
    // dentro de useFrame, a cada quadro, sem passar pelo React. A regra de imutabilidade do React Compiler
    // não se aplica a esse código (o projeto não usa o React Compiler).
    files: ['packages/hologram/src/react/**/*.tsx'],
    rules: { 'react-hooks/immutability': 'off' },
  },
);
