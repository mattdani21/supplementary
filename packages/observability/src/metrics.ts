/**
 * The telemetry required by docs/OPERATIONS.md.
 *
 * The metric names are a closed set, so a stage cannot invent a name that no dashboard reads.
 */

export const METRICS = [
  'compilation_stage_duration_ms',
  'model_call_total',
  'model_call_duration_ms',
  'queue_wait_ms',
  'source_extraction_failure_total',
  'schema_validation_failure_total',
  'audit_finding_total',
  'repair_attempt_total',
  'repair_success_total',
  'audio_generation_failure_total',
  'attempt_correct_total',
  'attempt_total',
  'day_one_publication_latency_ms',
  'full_course_publication_latency_ms',
  'budget_degradation_total',
  'prior_capability_decay_total',
  'job_claimed_total',
  'job_completed_total',
  'job_failed_total',
  'job_dead_lettered_total',
] as const;

export type MetricName = (typeof METRICS)[number];

export type Labels = Readonly<Record<string, string | number>>;

export interface MetricPoint {
  readonly name: MetricName;
  readonly value: number;
  readonly labels: Labels;
  readonly at: Date;
}

export interface Metrics {
  increment(name: MetricName, labels?: Labels, by?: number): void;
  observe(name: MetricName, value: number, labels?: Labels): void;
  /** Time a stage and record its duration whether it succeeds or throws. */
  time<T>(name: MetricName, labels: Labels, fn: () => Promise<T>): Promise<T>;
}

export interface MetricsRecorder extends Metrics {
  readonly points: readonly MetricPoint[];
  sum(name: MetricName, labels?: Labels): number;
}

const labelsMatch = (point: Labels, filter: Labels): boolean =>
  Object.entries(filter).every(([key, value]) => point[key] === value);

export const createMetrics = (now: () => Date = () => new Date()): MetricsRecorder => {
  const points: MetricPoint[] = [];

  const push = (name: MetricName, value: number, labels: Labels) => {
    points.push({ name, value, labels, at: now() });
  };

  return {
    points,
    increment: (name, labels = {}, by = 1) => push(name, by, labels),
    observe: (name, value, labels = {}) => push(name, value, labels),
    async time(name, labels, fn) {
      const started = Date.now();
      try {
        return await fn();
      } finally {
        push(name, Date.now() - started, labels);
      }
    },
    sum: (name, labels = {}) =>
      points
        .filter((p) => p.name === name && labelsMatch(p.labels, labels))
        .reduce((total, p) => total + p.value, 0),
  };
};
