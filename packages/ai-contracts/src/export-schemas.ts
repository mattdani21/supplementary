/**
 * Emit the generation contracts as JSON Schema into `specs/generation-schemas/`.
 *
 * The zod definitions are the source of truth; the files under `specs/` are the published,
 * language-neutral form of the same thing. They are generated rather than hand-written so the
 * two cannot drift — and a test asserts the checked-in files match what this produces, so
 * changing a contract without regenerating fails the build.
 *
 *     pnpm specs:generate
 */

import { z } from 'zod';
import { ALL_CONTRACTS } from './contracts.js';

export interface ExportedSchema {
  readonly filename: string;
  readonly json: string;
}

export const exportContractSchemas = (): ExportedSchema[] =>
  Object.values(ALL_CONTRACTS).map((contract) => {
    const schema = z.toJSONSchema(contract.schema, { io: 'output' });
    return {
      filename: `${contract.name}.v${contract.version.replace(/\./g, '-')}.json`,
      json: `${JSON.stringify(
        {
          $id: `https://gapos.dev/generation-schemas/${contract.name}/${contract.version}`,
          title: contract.name,
          description:
            `Structured response contract for the "${contract.name}" model call, version ` +
            `${contract.version}. Generated from packages/ai-contracts; do not edit by hand.`,
          ...schema,
        },
        null,
        2,
      )}\n`,
    };
  });
