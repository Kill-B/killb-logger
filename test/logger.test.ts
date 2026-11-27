import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Logger, type LoggerSettings, type LogLevel } from '../src/index.ts';
import { callerLine, capture } from './helpers.ts';

const LEVELS: LogLevel[] = ['silly', 'trace', 'debug', 'info', 'warn', 'error', 'fatal'];

// The settings an API service and a jobs service pass, with the production values (AC4).
const isTestEnv = false;
const apiSettings: LoggerSettings = {
  name: 'core_api',
  minLevel: 'info',
  displayRequestId: true,
  suppressStdOutput: !['local'].includes('production'),
  transports: [{ provider: 'gcpLogging', minLevel: 'info', enabled: !isTestEnv }],
};
const jobsLogger = () => {
  const isLocal = ['local', 'test'].includes('production');
  return new Logger({
    name: 'jobs',
    minLevel: 'info',
    suppressStdOutput: !isLocal,
    transports: [{ provider: 'gcpLogging', minLevel: 'info', enabled: !isLocal }],
  });
};

describe('today’s settings (AC4)', () => {
  for (const [name, build] of [
    ['API service', () => new Logger(apiSettings)],
    ['jobs service', jobsLogger],
  ] as const) {
    it(`${name}: info, warn, error and fatal write one line each; silly, trace and debug write none`, async () => {
      const logger = build();
      const { lines, pretty } = await capture(() => {
        for (const level of LEVELS) logger[level](`${level} message`, { level });
      });
      assert.deepEqual(
        lines.map(line => line.message),
        ['info message', 'warn message', 'error message', 'fatal message'],
      );
      assert.equal(pretty.length, 0);
    });
  }
});

describe('Cloud Logging line (AC5, AC6, AC7)', () => {
  const logger = new Logger({
    name: 'line-test',
    suppressStdOutput: true,
    transports: [{ provider: 'gcpLogging', enabled: true, options: { projectId: 'p1' } }],
  });

  it('has the lib-apm keys, the caller location and the request id', async () => {
    let expectedLine = 0;
    function callsTheLogger() {
      expectedLine = callerLine() + 1;
      logger.info('manual spot cleanup: not executed', { reason: 'x' });
    }
    const { stdout, lines } = await capture(() =>
      logger.setContextBlock(() => {
        logger.setRequestId('abc');
        callsTheLogger();
      }),
    );
    assert.equal(lines.length, 1);
    assert.deepEqual(stdout[0], {
      severity: 'INFO',
      message: 'manual spot cleanup: not executed',
      data: ['manual spot cleanup: not executed', { reason: 'x' }],
      x_request_id: 'abc',
      'logging.googleapis.com/sourceLocation': {
        file: 'test/logger.test.ts',
        line: String(expectedLine),
        function: 'callsTheLogger',
      },
      'logging.googleapis.com/trace': null,
    });
    assert.deepEqual(Object.keys(stdout[0] ?? {}), [
      'severity',
      'message',
      'data',
      'x_request_id',
      'logging.googleapis.com/sourceLocation',
      'logging.googleapis.com/trace',
    ]);
  });

  it('maps every level to its Cloud Logging severity and stream', async () => {
    const { stdout, stderr } = await capture(() => {
      for (const level of LEVELS) logger[level](level);
    });
    assert.deepEqual(
      stdout.map(line => [line.message, line.severity]),
      [
        ['silly', 'DEBUG'],
        ['trace', 'DEBUG'],
        ['debug', 'DEBUG'],
        ['info', 'INFO'],
      ],
    );
    assert.deepEqual(
      stderr.map(line => [line.message, line.severity]),
      [
        ['warn', 'WARNING'],
        ['error', 'ERROR'],
        ['fatal', 'CRITICAL'],
      ],
    );
  });

  it('derives message from the first argument and keeps an error in data', async () => {
    const error = new RangeError('out of range');
    const { lines } = await capture(() => {
      logger.error(error);
      logger.info({ a: 1 });
      logger.info();
      logger.info(null);
    });
    assert.equal(lines[0]?.message, 'RangeError: out of range');
    const data = lines[0]?.data[0] as Record<string, unknown>;
    assert.equal(data['name'], 'RangeError');
    assert.equal(data['message'], 'out of range');
    assert.match(String(data['stack']), /RangeError: out of range/);
    assert.deepEqual(
      lines.slice(1).map(line => [line.message, line.data]),
      [
        ['{"a":1}', [{ a: 1 }]],
        ['', []],
        ['null', [null]],
      ],
    );
  });

  it('never throws because of the value logged, at any level (AC18, AC23)', async () => {
    const node: Record<string, unknown> = { big: 1n, password: 'raw' };
    node['self'] = node;
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    const { lines } = await capture(() => {
      for (const level of LEVELS) assert.doesNotThrow(() => logger[level](node, proxy, Symbol('s')));
    });
    assert.equal(lines.length, LEVELS.length);
    for (const line of lines) {
      assert.equal(line.message, '{"big":"1","password":"***REDACTED***","self":"[Circular]"}');
      assert.deepEqual(line.data.slice(1), ['***REDACTED***', 'Symbol(s)']);
    }
  });

  it('masks on the transport and on the pretty output (AC11)', async () => {
    const both = new Logger({
      name: 'mask-test',
      mask: { keys: ['document'] },
      transports: [{ provider: 'gcpLogging', enabled: true }],
    });
    const { lines, pretty } = await capture(() =>
      both.info('login', { userPassword: 'raw-1', documentNumber: 'raw-2' }),
    );
    assert.deepEqual(lines[0]?.data[1], { userPassword: '***REDACTED***', documentNumber: '***REDACTED***' });
    assert.equal(pretty.length, 1);
    assert.ok(!pretty[0]?.includes('raw-1') && !pretty[0]?.includes('raw-2'));
  });
});

describe('outputs and levels', () => {
  it('suppressStdOutput keeps the transport; enabled:false silences it (AC12)', async () => {
    const suppressed = new Logger({
      name: 'a',
      suppressStdOutput: true,
      transports: [{ provider: 'gcpLogging', enabled: true }],
    });
    const disabled = new Logger({
      name: 'b',
      suppressStdOutput: true,
      transports: [{ provider: 'gcpLogging', enabled: false }],
    });
    const first = await capture(() => suppressed.info('x'));
    assert.equal(first.pretty.length, 0);
    assert.equal(first.lines.length, 1);
    const second = await capture(() => disabled.info('x'));
    assert.equal(second.lines.length + second.pretty.length, 0);
  });

  it('filters the terminal by the logger minLevel and each transport by its own (AC19)', async () => {
    const strictTransport = new Logger({
      name: 'levels',
      minLevel: 'info',
      transports: [{ provider: 'gcpLogging', minLevel: 'error', enabled: true }],
    });
    const out = await capture(() => {
      strictTransport.debug('debug line');
      strictTransport.info('info line');
      strictTransport.error('error line');
    });
    assert.deepEqual(
      out.pretty.map(line => /\t(\w+ line)/.exec(line)?.[1]),
      ['info line', 'error line'],
    );
    assert.deepEqual(
      out.lines.map(line => line.message),
      ['error line'],
    );

    const strictTerminal = new Logger({
      name: 'levels',
      minLevel: 'error',
      transports: [{ provider: 'gcpLogging', minLevel: 'info', enabled: true }],
    });
    const second = await capture(() => strictTerminal.info('info line'));
    assert.equal(second.pretty.length, 0);
    assert.deepEqual(
      second.lines.map(line => line.message),
      ['info line'],
    );
  });

  it('shows the request id in the terminal only with displayRequestId (AC25)', async () => {
    const run = async (displayRequestId: boolean) => {
      const logger = new Logger({
        name: 'display',
        displayRequestId,
        transports: [{ provider: 'gcpLogging', enabled: true }],
      });
      return capture(() =>
        logger.setContextBlock(() => {
          logger.setRequestId('req-display-1');
          logger.info('x');
        }),
      );
    };
    const shown = await run(true);
    assert.match(shown.pretty[0] ?? '', /\[display req-display-1 /);
    assert.equal(shown.lines[0]?.x_request_id, 'req-display-1');
    const hidden = await run(false);
    assert.ok(!(hidden.pretty[0] ?? '').includes('req-display-1'));
    assert.equal(hidden.lines[0]?.x_request_id, 'req-display-1');
  });

  it('defaults: terminal from silly with the request id, transport only when enabled (AC26)', async () => {
    const withoutEnabled = new Logger({ name: 'defaults', transports: [{ provider: 'gcpLogging' }] });
    const first = await capture(() =>
      withoutEnabled.setContextBlock(() => {
        withoutEnabled.setRequestId('abc');
        withoutEnabled.silly('silly line');
      }),
    );
    assert.equal(first.lines.length, 0);
    assert.equal(first.pretty.length, 1);
    assert.match(first.pretty[0] ?? '', /SILLY\t\[defaults abc test\/logger\.test\.ts:\d+\]\tsilly line/);

    const enabled = new Logger({
      name: 'defaults',
      suppressStdOutput: true,
      transports: [{ provider: 'gcpLogging', enabled: true }],
    });
    const second = await capture(() => enabled.silly('silly line'));
    assert.deepEqual(
      second.lines.map(line => [line.message, line.severity]),
      [['silly line', 'DEBUG']],
    );
  });

  it('ignores transports it does not know', async () => {
    const logger = new Logger({
      name: 'unknown',
      suppressStdOutput: true,
      transports: [{ provider: 'coralogix' as 'gcpLogging', enabled: true }],
    });
    const { lines } = await capture(() => logger.error('x'));
    assert.equal(lines.length, 0);
  });
});
