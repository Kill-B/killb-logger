export const LOG_LEVELS = ['silly', 'trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

export function levelRank(level: LogLevel): number {
  return LOG_LEVELS.indexOf(level);
}

export function isLogLevel(value: unknown): value is LogLevel {
  return typeof value === 'string' && (LOG_LEVELS as readonly string[]).includes(value);
}

export function resolveLevel(value: unknown): LogLevel {
  return isLogLevel(value) ? value : 'silly';
}

export const GCP_SEVERITY: Readonly<Record<LogLevel, string>> = {
  silly: 'DEBUG',
  trace: 'DEBUG',
  debug: 'DEBUG',
  info: 'INFO',
  warn: 'WARNING',
  error: 'ERROR',
  fatal: 'CRITICAL',
};
