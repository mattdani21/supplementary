/**
 * Structured logging.
 *
 * Every line is JSON and carries the run context. User content and prompt bodies are never
 * logged — see docs/SECURITY.md. Fields whose names look like content or credentials are
 * redacted on the way out, so a careless call site cannot leak.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface LogContext {
  readonly runId?: string;
  readonly gapId?: string;
  readonly userId?: string;
  readonly step?: string;
  readonly [key: string]: unknown;
}

export interface Logger {
  debug(message: string, fields?: LogContext): void;
  info(message: string, fields?: LogContext): void;
  warn(message: string, fields?: LogContext): void;
  error(message: string, fields?: LogContext): void;
  child(context: LogContext): Logger;
}

const REDACTED_KEYS = [
  'prompt',
  'instruction',
  'evidence',
  'script',
  'transcript',
  'response',
  'answer',
  'apikey',
  'api_key',
  'token',
  'secret',
  'password',
  'authorization',
  'rawstatement',
];

const shouldRedact = (key: string): boolean => {
  const normalised = key.toLowerCase().replace(/[-_]/g, '');
  return REDACTED_KEYS.some((candidate) => normalised.includes(candidate.replace(/[-_]/g, '')));
};

export const redact = (fields: Record<string, unknown>): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (shouldRedact(key)) {
      out[key] = '[redacted]';
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      out[key] = redact(value as Record<string, unknown>);
    } else {
      out[key] = value;
    }
  }
  return out;
};

export interface LogRecord {
  readonly level: LogLevel;
  readonly message: string;
  readonly time: string;
  readonly fields: Record<string, unknown>;
}

export type LogSink = (record: LogRecord) => void;

export const consoleSink: LogSink = (record) => {
  const line = JSON.stringify(record);
  if (record.level === 'error' || record.level === 'warn') console.error(line);
  else console.warn(line);
};

export interface LoggerOptions {
  readonly level?: LogLevel;
  readonly sink?: LogSink;
  readonly now?: () => Date;
}

export const createLogger = (context: LogContext = {}, options: LoggerOptions = {}): Logger => {
  const minimum = LEVEL_ORDER[options.level ?? 'info'];
  const sink = options.sink ?? consoleSink;
  const now = options.now ?? (() => new Date());

  const emit = (level: LogLevel, message: string, fields: LogContext = {}) => {
    if (LEVEL_ORDER[level] < minimum) return;
    sink({
      level,
      message,
      time: now().toISOString(),
      fields: redact({ ...context, ...fields }),
    });
  };

  return {
    debug: (message, fields) => emit('debug', message, fields),
    info: (message, fields) => emit('info', message, fields),
    warn: (message, fields) => emit('warn', message, fields),
    error: (message, fields) => emit('error', message, fields),
    child: (extra) => createLogger({ ...context, ...extra }, options),
  };
};

/** Captures records in memory. Used by tests to assert on what would be logged. */
export const createMemorySink = () => {
  const records: LogRecord[] = [];
  const sink: LogSink = (record) => void records.push(record);
  return { records, sink };
};
