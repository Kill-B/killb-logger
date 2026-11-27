import assert from 'node:assert/strict';
import { Logger } from '@killb/logger';

const lines = [];
const write = process.stdout.write.bind(process.stdout);
process.stdout.write = (chunk, ...rest) => {
  if (String(chunk).includes('"x_request_id"')) {
    lines.push(JSON.parse(String(chunk)));
    return true;
  }
  return write(chunk, ...rest);
};

const logger = new Logger({
  name: 'esm',
  suppressStdOutput: true,
  transports: [{ provider: 'gcpLogging', enabled: true }],
});
logger.setContextBlock(() => {
  logger.setRequestId('esm-1');
  logger.info('from esm', { token: 'raw' });
});
process.stdout.write = write;

assert.equal(typeof Logger, 'function');
assert.equal(lines.length, 1);
assert.equal(lines[0].x_request_id, 'esm-1');
assert.deepEqual(lines[0].data[1], { token: '***REDACTED***' });
assert.equal(lines[0]['logging.googleapis.com/sourceLocation'].file, 'index.js');
console.log(`ok: import { Logger } from '@killb/logger' on node ${process.version}`);
