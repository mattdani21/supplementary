/**
 * Cost accounting and budget enforcement.
 *
 * Budgets are checked *before* a call is made, not after it returns. A run that would exceed its
 * ceiling degrades — text-only instead of audio — rather than overspending and apologising.
 *
 * Money is handled in whole tenths of a cent (millicents) as integers. Floating-point cents
 * accumulate error across the hundreds of calls a single compilation makes.
 */

export type Millicents = number;

export const centsToMillicents = (cents: number): Millicents => Math.round(cents * 1000);
export const millicentsToCents = (millicents: Millicents): number => millicents / 1000;

export type CallPurpose =
  'classification' | 'planning' | 'teaching' | 'verification' | 'speech' | 'retrieval';

export interface UsageRecord {
  readonly runId: string;
  readonly userId: string;
  readonly purpose: CallPurpose;
  readonly provider: string;
  readonly model: string;
  readonly contract?: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly audioCharacters: number;
  readonly costMillicents: Millicents;
  readonly durationMs: number;
  /** Hash of the prompt and contract version, so a cost regression can be attributed. */
  readonly promptVersionHash: string;
  readonly at: Date;
}

export interface Budget {
  readonly perRunMillicents: Millicents;
  readonly perUserDailyMillicents: Millicents;
}

export const DEFAULT_BUDGET: Budget = {
  perRunMillicents: centsToMillicents(200),
  perUserDailyMillicents: centsToMillicents(1000),
};

export type BudgetDecision =
  | { allowed: true; remainingRunMillicents: Millicents }
  | { allowed: false; scope: 'run' | 'user_daily'; spent: Millicents; limit: Millicents };

const sameUtcDay = (a: Date, b: Date): boolean =>
  a.getUTCFullYear() === b.getUTCFullYear() &&
  a.getUTCMonth() === b.getUTCMonth() &&
  a.getUTCDate() === b.getUTCDate();

/**
 * Tracks spend and answers "may I make this call?". In-memory here; the Postgres-backed
 * implementation records the same shape so the ceiling survives a worker restart.
 */
export class CostAccountant {
  private readonly records: UsageRecord[] = [];

  constructor(private readonly budget: Budget = DEFAULT_BUDGET) {}

  /** Ask before spending. `estimate` is the worst-case cost of the call about to be made. */
  authorise(params: {
    runId: string;
    userId: string;
    estimateMillicents: Millicents;
    now?: Date;
  }): BudgetDecision {
    const now = params.now ?? new Date();
    const runSpent = this.spentForRun(params.runId);
    const projectedRun = runSpent + params.estimateMillicents;

    if (projectedRun > this.budget.perRunMillicents) {
      return {
        allowed: false,
        scope: 'run',
        spent: runSpent,
        limit: this.budget.perRunMillicents,
      };
    }

    const userSpent = this.spentForUserOnDay(params.userId, now);
    if (userSpent + params.estimateMillicents > this.budget.perUserDailyMillicents) {
      return {
        allowed: false,
        scope: 'user_daily',
        spent: userSpent,
        limit: this.budget.perUserDailyMillicents,
      };
    }

    return {
      allowed: true,
      remainingRunMillicents: this.budget.perRunMillicents - projectedRun,
    };
  }

  record(usage: UsageRecord): void {
    this.records.push(usage);
  }

  spentForRun(runId: string): Millicents {
    return this.records
      .filter((r) => r.runId === runId)
      .reduce((total, r) => total + r.costMillicents, 0);
  }

  spentForUserOnDay(userId: string, day: Date): Millicents {
    return this.records
      .filter((r) => r.userId === userId && sameUtcDay(r.at, day))
      .reduce((total, r) => total + r.costMillicents, 0);
  }

  usageForRun(runId: string): readonly UsageRecord[] {
    return this.records.filter((r) => r.runId === runId);
  }

  /** Per-stage cost attribution for the operations view. */
  costByPurpose(runId: string): Record<CallPurpose, Millicents> {
    const totals: Record<CallPurpose, Millicents> = {
      classification: 0,
      planning: 0,
      teaching: 0,
      verification: 0,
      speech: 0,
      retrieval: 0,
    };
    for (const record of this.usageForRun(runId)) {
      totals[record.purpose] += record.costMillicents;
    }
    return totals;
  }
}
