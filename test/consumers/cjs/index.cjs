const assert = require('node:assert/strict');
const { Logger } = require('@killb/logger');

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
  name: 'cjs',
  suppressStdOutput: true,
  transports: [{ provider: 'gcpLogging', enabled: true }],
});
logger.setContextBlock(() => {
  logger.setRequestId('cjs-1');
  logger.info('from commonjs', { token: 'raw' });
});
process.stdout.write = write;

assert.equal(typeof Logger, 'function');
assert.equal(lines.length, 1);
assert.equal(lines[0].x_request_id, 'cjs-1');
assert.deepEqual(lines[0].data[1], { token: '***REDACTED***' });
assert.equal(lines[0]['logging.googleapis.com/sourceLocation'].file, 'index.cjs');
console.log(`ok: require('@killb/logger') on node ${process.version}`);
