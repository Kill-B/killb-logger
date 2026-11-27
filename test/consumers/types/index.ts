import type { IncomingHttpHeaders } from 'node:http';
import { Logger, type LoggerSettings, type LogLevel, type TransportSettings } from '@killb/logger';

// The handler shape Express accepts, written out so no @types/express is needed.
type ExpressHandler = (
  req: { headers: IncomingHttpHeaders; method?: string; url?: string },
  res: { statusCode: number },
  next: (err?: unknown) => void,
) => void;
declare const app: { use(handler: ExpressHandler): void };

const level: LogLevel = 'info';
const transport: TransportSettings = {
  provider: 'gcpLogging',
  minLevel: level,
  enabled: true,
  options: { projectId: 'p' },
};
const settings: LoggerSettings = {
  name: 'types',
  minLevel: 'warn',
  displayRequestId: false,
  suppressStdOutput: true,
  mask: { keys: ['iban'] },
  transports: [transport],
};
const logger = new Logger(settings);

app.use(logger.setContextMiddleware);
const sync: number = logger.setContextBlock(() => 1);
const async: Promise<string> = logger.setAsyncContextBlock(async () => 'x');
logger.setRequestId('abc');
logger.setRequestId();
const id: string | undefined = logger.getRequestId();
for (const method of ['silly', 'trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const)
  logger[method]('x', { a: 1 }, 1n);

// @ts-expect-error the only provider is gcpLogging
const wrong: TransportSettings = { provider: 'coralogix' };
// @ts-expect-error name is required
const missing: LoggerSettings = {};

export { async, id, missing, sync, wrong };
