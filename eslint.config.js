import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/coverage/**',
      '**/*.d.ts',
      'infra/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      'no-console': ['error', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
    },
  },
  // ARCHITECTURAL CONSTRAINT (roadmap 15.1): domain logic must not import
  // web framework code, and must not call AI providers directly.
  {
    files: ['packages/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['next', 'next/*', 'react', 'react-dom'],
              message: 'Domain must not import web framework code.',
            },
            {
              group: ['@gapos/provider-adapters', '@gapos/database'],
              message: 'Domain must not depend on adapters or persistence.',
            },
            {
              group: ['pg', 'openai', '@anthropic-ai/*'],
              message: 'Domain must not talk to infrastructure directly.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/web/**/*.ts', 'apps/web/**/*.tsx', 'apps/worker/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['openai', '@anthropic-ai/*', 'elevenlabs'],
              message:
                'Application code must not call AI providers directly; go through @gapos/provider-adapters.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.test.ts', 'packages/test-fixtures/**/*.ts', 'tests/**/*.ts'],
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
);
