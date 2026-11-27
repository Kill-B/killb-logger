import type { SourceLocation } from '../caller.ts';

import { GCP_SEVERITY, levelRank, type LogLevel } from '../levels.ts';
import { type Json, REDACTED } from '../serialize.ts';
import { agentTraceId, cloudTrace, resolveProjectId } from '../trace.ts';

export interface LogRecord {
  level: LogLevel;
  message: string;
  data: Json[];
  requestId: string | undefined;
  traceId: string | undefined;
  location: SourceLocation;
}

export interface Transport {
  readonly minLevel: LogLevel;
  write(record: LogRecord): void;
}

export interface GcpLoggingOptions {
  projectId?: string;
}

type Writer = (stream: 'stdout' | 'stderr', line: string) => void;

const processWriter: Writer = (stream, line) => {
  (stream === 'stderr' ? process.stderr : process.stdout).write(line);
};

/** One JSON line per log call, in the shape Cloud Logging lifts into a structured entry. */
export class GcpLoggingTransport implements Transport {
  readonly minLevel: LogLevel;
  readonly #projectId: string | undefined;
  readonly #writer: Writer;

  constructor(minLevel: LogLevel, options: GcpLoggingOptions = {}, writer: Writer = processWriter) {
    this.minLevel = minLevel;
    this.#projectId = typeof options.projectId === 'string' && options.projectId ? options.projectId : undefined;
    this.#writer = writer;
  }

  line(record: LogRecord): string {
    const trace = cloudTrace(record.traceId ?? agentTraceId(), resolveProjectId(this.#projectId));
    try {
      return JSON.stringify({
        severity: GCP_SEVERITY[record.level],
        message: record.message,
        data: record.data,
        x_request_id: record.requestId || 'INTERNAL',
        'logging.googleapis.com/sourceLocation': record.location,
        'logging.googleapis.com/trace': trace,
      });
    } catch {
      return JSON.stringify({
        severity: GCP_SEVERITY[record.level],
        message: REDACTED,
        data: [REDACTED],
        x_request_id: record.requestId || 'INTERNAL',
        'logging.googleapis.com/sourceLocation': record.location,
        'logging.googleapis.com/trace': trace,
      });
    }
  }

  write(record: LogRecord): void {
    const stream = levelRank(record.level) >= levelRank('warn') ? 'stderr' : 'stdout';
    this.#writer(stream, `${this.line(record)}\n`);
  }
}
