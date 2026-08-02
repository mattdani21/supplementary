/**
 * Every structured object a model produces carries a schema version.
 *
 * The version is part of the payload, not metadata alongside it, so a stored artefact always
 * knows which contract produced it. When a contract changes shape, the version changes, and old
 * rows remain readable by the reader that understands their version — see AGENTS.md rule 3.
 */

import { z } from 'zod';

export type SchemaVersion = `${number}.${number}.${number}`;

export interface Contract<T> {
  /** Stable identifier used in logs, cost accounting and fixture lookup. */
  readonly name: string;
  readonly version: SchemaVersion;
  readonly schema: z.ZodType<T>;
}

/**
 * Build a contract whose payload must declare the matching `schemaVersion`. A response for the
 * wrong version fails validation at the adapter boundary rather than being silently accepted.
 */
export const defineContract = <Shape extends z.ZodRawShape>(
  name: string,
  version: SchemaVersion,
  shape: Shape,
) => {
  const schema = z.object({ schemaVersion: z.literal(version), ...shape }).strict();
  return { name, version, schema } as Contract<z.infer<typeof schema>>;
};

export const CONTRACT_NAMES = [
  'gap_normalisation',
  'curriculum_plan',
  'lesson_package',
  'verification_report',
  'diagnostic_interpretation',
  'repair_result',
] as const;

export type ContractName = (typeof CONTRACT_NAMES)[number];
