import { Logger as TsLogger } from 'tslog';

import { callerLocation, type SourceLocation } from './caller.ts';
import { currentContext, runInContext, setContextRequestId } from './context.ts';
import { levelRank, type LogLevel, resolveLevel } from './levels.ts';
import { Serializer } from './serialize.ts';
import { type Headers, traceIdFromHeaders } from './trace.ts';
import { GcpLoggingTransport, type LogRecord, type Transport } from './transports/gcpLogging.ts';

export interface TransportSettings {
  provider: 'gcpLogging';
  /** Lowest level this transport writes. Default `'silly'`. */
  minLevel?: LogLevel;
  /** The transport writes only when this is `true`. */
  enabled?: boolean;
  options?: { projectId?: string };
}

export interface LoggerSettings {
  name: string;
  /** Lowest level written to the pretty terminal output. Transports use their own `minLevel`. Default `'silly'`. */
  minLevel?: LogLevel;
  /** Show the request id in the pretty terminal output. Default `true`. */
  displayRequestId?: boolean;
  /** Turn off the pretty terminal output. Transports still write. Default `false`. */
  suppressStdOutput?: boolean;
  /** Words added to the default masked words. A key containing any of them, ignoring case, is masked. */
  mask?: { keys?: string[] };
  transports?: TransportSettings[];
}

interface PendingLine {
  requestId: string | undefined;
  location: SourceLocation;
}

export class Logger {
  readonly #name: string;
  readonly #stdoutRank: number;
  readonly #displayRequestId: boolean;
  readonly #serializer: Serializer;
  readonly #transports: Transport[];
  readonly #pretty: TsLogger<unknown> | undefined;
  #pending: PendingLine | undefined;

  constructor(settings: LoggerSettings) {
    this.#name = typeof settings.name === 'string' ? settings.name : '';
    this.#stdoutRank = levelRank(resolveLevel(settings.minLevel));
    this.#displayRequestId = settings.displayRequestId !== false;
    this.#serializer = new Serializer(Array.isArray(settings.mask?.keys) ? settings.mask.keys : []);
    this.#transports = (settings.transports ?? [])
      .filter(transport => transport.enabled === true && transport.provider === 'gcpLogging')
      .map(transport => new GcpLoggingTransport(resolveLevel(transport.minLevel), transport.options));
    this.#pretty = settings.suppressStdOutput === true ? undefined : this.#createPretty();
  }

  silly(...args: unknown[]): void {
    this.#emit('silly', args, this.silly);
  }

  trace(...args: unknown[]): void {
    this.#emit('trace', args, this.trace);
  }

  debug(...args: unknown[]): void {
    this.#emit('debug', args, this.debug);
  }

  info(...args: unknown[]): void {
    this.#emit('info', args, this.info);
  }

  warn(...args: unknown[]): void {
    this.#emit('warn', args, this.warn);
  }

  error(...args: unknown[]): void {
    this.#emit('error', args, this.error);
  }

  fatal(...args: unknown[]): void {
    this.#emit('fatal', args, this.fatal);
  }

  // The context methods are arrow properties so they keep working when passed around unbound,
  // as in `app.use(logger.setContextMiddleware)`.

  /** Express-style middleware: runs the rest of the request in its own context, with the incoming trace id. */
  setContextMiddleware = (
    req: { headers: Record<string, string | string[] | undefined> },
    res: unknown,
    next: () => void,
  ): void => {
    void res;
    runInContext(next, { traceId: traceIdFromHeaders(req?.headers as Headers | undefined) });
  };

  /** Runs `fn` in a new context that starts with the current request id and trace id. */
  setContextBlock = <T>(fn: () => T): T => runInContext(fn);

  /** Runs `fn` in a new context that starts with the current request id and trace id, across awaits. */
  setAsyncContextBlock = <T>(fn: () => Promise<T>): Promise<T> => runInContext(fn);

  /** Sets the request id of the current context. Outside a context, or with an empty value, it does nothing. */
  setRequestId = (id?: string): void => {
    setContextRequestId(typeof id === 'string' ? id : undefined);
  };

  /** The request id of the current context, or `undefined` outside one. */
  getRequestId = (): string | undefined => currentContext()?.requestId;

  #emit(level: LogLevel, args: unknown[], skip: (...args: never[]) => unknown): void {
    try {
      const rank = levelRank(level);
      const toStdout = this.#pretty !== undefined && rank >= this.#stdoutRank;
      const sinks = this.#transports.filter(transport => rank >= levelRank(transport.minLevel));
      if (!toStdout && sinks.length === 0) return;

      const safe = args.map(arg => this.#serializer.toSafe(arg));
      const context = currentContext();
      const location = callerLocation(skip);

      if (toStdout) this.#printPretty(level, safe, context?.requestId, location);
      if (sinks.length === 0) return;

      const record: LogRecord = {
        level,
        message: this.#serializer.messageOf(args, safe[0]),
        data: safe.map(value => value ?? null),
        requestId: context?.requestId,
        traceId: context?.traceId,
        location,
      };
      for (const sink of sinks) {
        try {
          sink.write(record);
        } catch {
          // A failing sink must not break the caller or the other sinks.
        }
      }
    } catch {
      // Logging never throws into the code that logs.
    }
  }

  #printPretty(level: LogLevel, safe: unknown[], requestId: string | undefined, location: SourceLocation): void {
    if (!this.#pretty) return;
    this.#pending = { requestId, location };
    try {
      this.#pretty.log(levelRank(level), level.toUpperCase(), ...safe);
    } finally {
      this.#pending = undefined;
    }
  }

  #createPretty(): TsLogger<unknown> {
    return new TsLogger({
      type: 'pretty',
      name: this.#name || undefined,
      minLevel: 0,
      stack: { capture: 'off' },
      pretty: {
        template:
          '{{yyyy}}-{{mm}}-{{dd}} {{hh}}:{{MM}}:{{ss}}.{{ms}}\t{{logLevelName}}\t[{{name}}{{kbRequestId}} {{kbLocation}}]\t',
        placeholders: {
          kbRequestId: () => {
            const requestId = this.#pending?.requestId;
            return this.#displayRequestId && requestId ? ` ${requestId}` : '';
          },
          kbLocation: () => {
            const location = this.#pending?.location;
            return location ? `${location.file}:${location.line}` : '';
          },
        },
      },
    });
  }
}
