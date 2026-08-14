import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const resolvePackage = (name: string) =>
  fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url));

export default defineConfig({
  esbuild: {
    // Component tests render JSX server-side (renderToStaticMarkup); the repo's tsconfig uses
    // `jsx: preserve` for Next, so vitest must own the transform — automatic runtime, no
    // React-in-scope requirement.
    jsx: 'automatic',
  },
  resolve: {
    alias: {
      '@gapos/ai-contracts': resolvePackage('ai-contracts'),
      '@gapos/database': resolvePackage('database'),
      '@gapos/domain': resolvePackage('domain'),
      '@gapos/evaluation': resolvePackage('evaluation'),
      '@gapos/observability': resolvePackage('observability'),
      '@gapos/provider-adapters': resolvePackage('provider-adapters'),
      '@gapos/test-fixtures': resolvePackage('test-fixtures'),
    },
  },
  test: {
    environment: 'node',
    include: [
      'packages/**/*.test.ts',
      'packages/**/*.test.tsx',
      'apps/**/*.test.ts',
      'apps/**/*.test.tsx',
      'tests/**/*.test.ts',
      'tests/**/*.test.tsx',
    ],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.next/**'],
    // Integration suites that need Postgres opt in explicitly via GAPOS_TEST_DATABASE_URL.
    passWithNoTests: false,
  },
});
