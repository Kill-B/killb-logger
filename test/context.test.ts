import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Logger } from '../src/index.ts';
import { capture, sleep } from './helpers.ts';

const newLogger = () =>
  new Logger({
    name: 'context-test',
    suppressStdOutput: true,
    transports: [{ provider: 'gcpLogging', enabled: true }],
  });

describe('request context', () => {
  it('keeps each of 100 concurrent contexts apart (AC8)', async () => {
    const logger = newLogger();
    const { lines } = await capture(() =>
      Promise.all(
        Array.from({ length: 100 }, (_, index) =>
          logger.setAsyncContextBlock(async () => {
            logger.setRequestId(`req-${index}`);
            await sleep(Math.floor(Math.random() * 15));
            logger.info(`line-${index}`);
            await sleep(Math.floor(Math.random() * 15));
            logger.info(`line-${index}`);
          }),
        ),
      ),
    );
    assert.equal(lines.length, 200);
    for (const line of lines) assert.equal(line.x_request_id, `req-${line.message.slice('line-'.length)}`);
  });

  it('does nothing outside a context (AC9)', async () => {
    const logger = newLogger();
    const { lines } = await capture(() => {
      assert.doesNotThrow(() => logger.setRequestId('abc'));
      assert.equal(logger.getRequestId(), undefined);
      logger.info('x');
    });
    assert.equal(lines[0]?.x_request_id, 'INTERNAL');
  });

  it('works when the context methods are called unbound (AC17)', async () => {
    const logger = newLogger();
    const { setContextMiddleware, setContextBlock, setAsyncContextBlock, setRequestId, getRequestId } = logger;

    setContextMiddleware({ headers: {} }, {}, () => {
      setRequestId('from-middleware');
      assert.equal(getRequestId(), 'from-middleware');
    });
    assert.equal(
      setContextBlock(() => {
        setRequestId('from-block');
        return getRequestId();
      }),
      'from-block',
    );
    assert.equal(
      await setAsyncContextBlock(async () => {
        setRequestId('from-async-block');
        await sleep(1);
        return getRequestId();
      }),
      'from-async-block',
    );
    assert.equal(getRequestId(), undefined);
  });

  it('keeps the current id when set to an empty or undefined value (AC21)', async () => {
    const logger = newLogger();
    const { lines } = await capture(() =>
      logger.setContextBlock(() => {
        logger.setRequestId('abc');
        logger.setRequestId('');
        logger.info('after empty');
        logger.setRequestId(undefined);
        logger.info('after undefined');
        (logger.setRequestId as (id: unknown) => void)(null);
        logger.info('after null');
      }),
    );
    assert.deepEqual(
      lines.map(line => line.x_request_id),
      ['abc', 'abc', 'abc'],
    );
  });

  it('starts a nested context with the outer id and trace, and keeps its own id inside (AC24)', async () => {
    const logger = new Logger({
      name: 'context-test',
      suppressStdOutput: true,
      transports: [{ provider: 'gcpLogging', enabled: true, options: { projectId: 'p1' } }],
    });
    const traceparent = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01';
    const { lines } = await capture(
      () =>
        new Promise<void>(resolve => {
          logger.setContextMiddleware({ headers: { traceparent } }, {}, () => {
            logger.setRequestId('abc');
            void logger
              .setAsyncContextBlock(async () => {
                await sleep(1);
                logger.info('inner before');
                logger.setRequestId('xyz');
                logger.info('inner after');
              })
              .then(() => {
                logger.info('outer after');
                resolve();
              });
          });
        }),
    );
    assert.deepEqual(
      lines.map(line => [line.message, line.x_request_id, line['logging.googleapis.com/trace']]),
      [
        ['inner before', 'abc', 'projects/p1/traces/0af7651916cd43dd8448eb211c80319c'],
        ['inner after', 'xyz', 'projects/p1/traces/0af7651916cd43dd8448eb211c80319c'],
        ['outer after', 'abc', 'projects/p1/traces/0af7651916cd43dd8448eb211c80319c'],
      ],
    );
  });

  it('returns what the block returns and lets its errors through', async () => {
    const logger = newLogger();
    assert.equal(
      logger.setContextBlock(() => 42),
      42,
    );
    await assert.rejects(
      logger.setAsyncContextBlock(async () => {
        throw new Error('block failed');
      }),
      /block failed/,
    );
  });
});
