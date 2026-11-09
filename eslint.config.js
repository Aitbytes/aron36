import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Frontières d'architecture (voir docs/ARCHITECTURE.md).
 * Le domaine est pur : ni React, ni DOM, ni horloge/aléa implicites.
 * Ces règles sont le contrat exécutable de la Phase 1.
 */
const domainRestrictions = {
  files: ['src/domain/**/*.{ts,tsx}'],
  rules: {
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          {
            group: [
              'react',
              'react-dom',
              'react/*',
              'react-dom/*',
              '@/ui/*',
              '@/infrastructure/*',
              '@/application/*',
              '@/i18n/*',
              '*.css',
              'node:*',
            ],
            message:
              'Le domaine est pur : aucune dépendance à React, au DOM, aux couches applicatives ou à l’infrastructure.',
          },
        ],
      },
    ],
    'no-restricted-globals': [
      'error',
      { name: 'window', message: 'Le domaine ne touche pas au DOM.' },
      { name: 'document', message: 'Le domaine ne touche pas au DOM.' },
      { name: 'navigator', message: 'Le domaine ne touche pas au navigateur.' },
      { name: 'localStorage', message: 'Passe par StoragePort.' },
      { name: 'sessionStorage', message: 'Passe par StoragePort.' },
      { name: 'fetch', message: 'Le domaine ne fait aucune I/O.' },
      { name: 'crypto', message: 'Passe par RandomPort.' },
      { name: 'performance', message: 'Passe par ClockPort.' },
      { name: 'setTimeout', message: 'Passe par ClockPort / la couche application.' },
      { name: 'setInterval', message: 'Passe par ClockPort / la couche application.' },
      { name: 'requestAnimationFrame', message: 'Le domaine ne touche pas au DOM.' },
      { name: 'Date', message: 'Le domaine reçoit EpochMs via ClockPort.' },
    ],
    'no-restricted-properties': [
      'error',
      {
        object: 'Math',
        property: 'random',
        message: 'Passe par RandomPort pour un tirage reproductible.',
      },
      {
        object: 'Date',
        property: 'now',
        message: 'Passe par ClockPort.',
      },
    ],
  },
};

const applicationRestrictions = {
  files: ['src/application/**/*.{ts,tsx}'],
  rules: {
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          {
            group: ['react', 'react-dom', 'react/*', 'react-dom/*', '@/ui/*', '@/infrastructure/*'],
            message:
              'L’application orchestre le domaine et les ports ; elle ne dépend ni de React ni d’un adaptateur concret.',
          },
        ],
      },
    ],
  },
};

const infrastructureRestrictions = {
  files: ['src/infrastructure/**/*.{ts,tsx}'],
  rules: {
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          {
            group: ['@/ui/*', 'react-dom/client'],
            message: 'L’infrastructure ne dépend jamais de l’interface.',
          },
        ],
      },
    ],
  },
};

const uiRestrictions = {
  files: ['src/ui/**/*.{ts,tsx}'],
  rules: {
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          {
            group: ['@/infrastructure/*'],
            message: 'L’interface consomme les cas d’usage, jamais un adaptateur concret.',
          },
        ],
      },
    ],
  },
};

export default tseslint.config(
  {
    ignores: [
      'dist',
      'coverage',
      'node_modules',
      '.worktrees',
      'docs/legacy',
      'playwright-report',
      'test-results',
    ],
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 2023,
      globals: { ...globals.node },
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      ecmaVersion: 2023,
      globals: { ...globals.browser },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
      'jsx-a11y': jsxA11y,
    },
    rules: {
      ...reactHooks.configs.flat.recommended.rules,
      ...jsxA11y.flatConfigs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    files: ['**/*.test.{ts,tsx}', 'src/test/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
    },
  },
  domainRestrictions,
  applicationRestrictions,
  infrastructureRestrictions,
  uiRestrictions,
  prettier,
);
