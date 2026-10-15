import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/out/**',
      '**/.next/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/src/generated/**',
      // Interface montada para o app (cópia do build do Next) e saídas do empacotamento.
      'apps/desktop/stage/**',
      'apps/desktop/release/**',
      'apps/desktop/release-test/**',
      'jesus-ia-ideacao.md',
    ],
  },
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
    // Scripts de build e manutenção rodam no Node.
    files: ['**/scripts/**/*.{js,mjs}', '**/*.config.{js,mjs}'],
    languageOptions: { globals: globals.node },
  },
  {
    // Cena 3D: o padrão do React Three Fiber é mudar objetos do Three.js (materiais, uniforms, posições)
    // dentro de useFrame, a cada quadro, sem passar pelo React. A regra de imutabilidade do React Compiler
    // não se aplica a esse código (o projeto não usa o React Compiler).
    files: ['packages/hologram/src/react/**/*.tsx'],
    rules: { 'react-hooks/immutability': 'off' },
  },
);
