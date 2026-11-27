# @killb/logger

Structured logger for Node.js services that run on Google Cloud. It writes one JSON line per log call in the shape Cloud Logging turns into a structured entry, keeps a request id and a trace id per request across `await`s, and masks secrets before anything is written.

- One runtime-dependency-free package: [tslog](https://tslog.js.org) is bundled for the pretty terminal output.
- CommonJS and ESM, Node.js 22 or later. Works under Jest 29 and 30 with no extra configuration.

## Install

```bash
npm install @killb/logger
```

## Quick start

```ts
import { Logger } from '@killb/logger';

export const logger = new Logger({
  name: 'payments-api',
  minLevel: 'info',
  suppressStdOutput: process.env.NODE_ENV !== 'local',
  transports: [{ provider: 'gcpLogging', minLevel: 'info', enabled: process.env.NODE_ENV !== 'test' }],
});

logger.info('payout created', { payoutId: 'po_123', apiKey: 'sk_live_…' });
// {"severity":"INFO","message":"payout created","data":["payout created",{"payoutId":"po_123","apiKey":"***REDACTED***"}],...}
```

## Express setup

Register the context middleware first, then set the request id:

```ts
import express from 'express';
import { randomUUID } from 'node:crypto';
import { logger } from './logger';

const app = express();
app.use(logger.setContextMiddleware); // one context per request; reads the trace header
app.use((req, _res, next) => {
  logger.setRequestId((req.headers['x-request-id'] as string) || randomUUID());
  next();
});
```

The context methods can be passed around unbound, as above.

## NestJS setup

Use the same middleware on the underlying HTTP adapter, and back Nest's logger with this one:

```ts
// main.ts
const app = await NestFactory.create(AppModule, { bufferLogs: true });
app.use(logger.setContextMiddleware);
app.useLogger(app.get(LoggerService));
```

```ts
// logger.service.ts
import { ConsoleLogger, Injectable } from '@nestjs/common';
import { logger } from './logger';

@Injectable()
export class LoggerService extends ConsoleLogger {
  log(message: unknown, ...params: unknown[]) {
    logger.info(message, params);
  }
  error(message: unknown, ...params: unknown[]) {
    logger.error(message, params);
  }
  warn(message: unknown, ...params: unknown[]) {
    logger.warn(message, params);
  }
  debug(message: unknown, ...params: unknown[]) {
    logger.debug(message, params);
  }
  verbose(message: unknown, ...params: unknown[]) {
    logger.debug(message, params);
  }
  fatal(message: unknown, ...params: unknown[]) {
    logger.fatal(message, params);
  }
}
```

A Nest middleware that calls `logger.setRequestId(...)` then runs inside the request's context.

## Pub/Sub consumer context

Messages don't go through HTTP middleware. Open a context per message and carry the request id in the message attributes:

```ts
// publisher
await topic.publishMessage({ data, attributes: { requestId: logger.getRequestId() ?? '' } });

// subscriber
subscription.on('message', message =>
  logger.setAsyncContextBlock(async () => {
    logger.setRequestId(message.attributes.requestId); // an empty or missing id keeps the current one
    logger.info('message received');
    await handle(message);
    message.ack();
  }),
);
```

A context opened inside another one starts with the outer request id and trace id. An id set inside it is not seen outside it.

## Settings

| Setting             | Type                                                                      | Default   | What it does                                                                             |
| ------------------- | ------------------------------------------------------------------------- | --------- | ---------------------------------------------------------------------------------------- |
| `name`              | `string`                                                                  | required  | Shown in the pretty terminal output.                                                     |
| `minLevel`          | `'silly' \| 'trace' \| 'debug' \| 'info' \| 'warn' \| 'error' \| 'fatal'` | `'silly'` | Lowest level written to the pretty terminal output. Transports use their own `minLevel`. |
| `displayRequestId`  | `boolean`                                                                 | `true`    | Shows the request id in the pretty terminal output. The transport line always has it.    |
| `suppressStdOutput` | `boolean`                                                                 | `false`   | Turns off the pretty terminal output. Transports still write.                            |
| `mask.keys`         | `string[]`                                                                | `[]`      | Words added to the default masked words. The defaults can't be removed.                  |
| `transports`        | `TransportSettings[]`                                                     | `[]`      | Where lines go besides the terminal.                                                     |

`TransportSettings`:

| Setting             | Type           | Default   | What it does                                   |
| ------------------- | -------------- | --------- | ---------------------------------------------- |
| `provider`          | `'gcpLogging'` | required  | The Cloud Logging transport.                   |
| `enabled`           | `boolean`      | off       | The transport writes only when this is `true`. |
| `minLevel`          | level          | `'silly'` | Lowest level this transport writes.            |
| `options.projectId` | `string`       | see Trace | Google Cloud project for the trace field.      |

### Methods

| Method                                                      | Signature                                                                          |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `silly`, `trace`, `debug`, `info`, `warn`, `error`, `fatal` | `(...args: unknown[]): void`                                                       |
| `setContextMiddleware`                                      | `(req: { headers }, res: unknown, next: () => void): void`                         |
| `setContextBlock`                                           | `<T>(fn: () => T): T`                                                              |
| `setAsyncContextBlock`                                      | `<T>(fn: () => Promise<T>): Promise<T>`                                            |
| `setRequestId`                                              | `(id?: string): void`. Outside a context, or with an empty value, it does nothing. |
| `getRequestId`                                              | `(): string \| undefined`. `undefined` outside a context.                          |

Logging never throws into the code that logs.

## Cloud Logging line shape

The `gcpLogging` transport writes one JSON line per call. `debug` and `info` go to stdout; `warn`, `error` and `fatal` go to stderr.

```json
{
  "severity": "INFO",
  "message": "payout created",
  "data": ["payout created", { "payoutId": "po_123" }],
  "x_request_id": "6f1c…",
  "logging.googleapis.com/sourceLocation": {
    "file": "src/payouts/payout.service.ts",
    "line": "42",
    "function": "create"
  },
  "logging.googleapis.com/trace": "projects/my-project/traces/0af7651916cd43dd8448eb211c80319c"
}
```

- `severity`: `silly`, `trace` and `debug` are `DEBUG`; `info` is `INFO`; `warn` is `WARNING`; `error` is `ERROR`; `fatal` is `CRITICAL`.
- `message`: the first argument when it is a string. An `Error` gives `<name>: <message>`; any other value gives its masked JSON text; no argument or `undefined` gives `""`.
- `data`: every argument, masked. An error keeps `name`, `message` and `stack`. A circular reference is written as `"[Circular]"`; a BigInt as its digits; a function as `"[Function: <name>]"`; a symbol as `"Symbol(<description>)"`. Keys whose value is `undefined` are left out.
- `x_request_id`: the context's request id, or `"INTERNAL"` outside a context.
- `sourceLocation`: the code that called the logger. When the compiled file has a source map next to it (or inline), the original file and line are used.
- `trace`: see below, or `null`.

### Trace

`setContextMiddleware` reads the trace id from `traceparent` (W3C) and, when that is missing or malformed, from `X-Cloud-Trace-Context`. The project is the transport's `options.projectId`, else `GOOGLE_CLOUD_PROJECT`, else `GCP_PROJECT`, else the project of a running Google trace agent. With no valid trace id or no project, the field is `null`.

## Masking

Before anything is written (terminal or transport), the value of every key whose name contains one of these words, ignoring case, becomes `***REDACTED***`, at any depth, in objects, arrays, maps and error properties:

`password`, `passwd`, `secret`, `token`, `authorization`, `cookie`, `apikey`, `api_key`, `api-key`, `privatekey`, `private_key`, `signature`, `cardnumber`, `card_number`, `cvv`, `cvc`, `securitycode`, `ssn`, `socialsecurity`, `sessionid`, `otp`, `bearer`, `creditcard`.

- Add words with `mask.keys`. The default words can't be removed or turned off.
- A value that can't be read (a getter that throws, a revoked proxy) is written as `***REDACTED***`, never raw.
- Some harmless keys are masked too (`tokenType`, `className`). That is on purpose.
- Masking is by key name only. Secrets inside string values (a token in a message, a URL query string) are not detected: don't log them.
- Personal data (names, documents, emails) is not masked by value. Mask it, or leave it out, where you log it.

## Releases

Releases are published from `main` by semantic-release with npm provenance. Commit messages follow Conventional Commits: `fix:` for a patch, `feat:` for a minor, a `BREAKING CHANGE:` footer for a major.

## License

MIT. See `LICENSE`. The bundled tslog keeps its own MIT license, in `THIRD_PARTY_NOTICES.md`.
