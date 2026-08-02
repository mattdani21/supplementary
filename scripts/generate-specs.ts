/**
 * Regenerate `specs/generation-schemas/` from the zod contracts.
 *
 *     pnpm specs:generate
 */

import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exportContractSchemas } from '@gapos/ai-contracts';

const outputDir = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'specs',
  'generation-schemas',
);

await mkdir(outputDir, { recursive: true });

const schemas = exportContractSchemas();
const expected = new Set(schemas.map((s) => s.filename));

// Remove files for contracts that no longer exist, so a deleted contract does not leave a
// published schema behind claiming to still be supported.
for (const existing of await readdir(outputDir).catch(() => [])) {
  if (existing.endsWith('.json') && !expected.has(existing)) {
    await rm(join(outputDir, existing));
  }
}

for (const schema of schemas) {
  await writeFile(join(outputDir, schema.filename), schema.json);
}

console.warn(`Wrote ${schemas.length} generation schemas to specs/generation-schemas/`);
