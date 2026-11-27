import { Logger } from '@killb/logger';

describe('@killb/logger under Jest with ts-jest', () => {
  it('logs a masked line with the request id', () => {
    const lines: string[] = [];
    const spy = jest.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      lines.push(String(chunk));
      return true;
    });
    const logger = new Logger({
      name: 'jest',
      minLevel: 'info',
      displayRequestId: true,
      suppressStdOutput: true,
      transports: [{ provider: 'gcpLogging', minLevel: 'info', enabled: true }],
    });
    logger.setContextBlock(() => {
      logger.setRequestId('jest-1');
      logger.info('from jest', { password: 'raw' });
    });
    spy.mockRestore();

    const line = JSON.parse(lines.find(text => text.includes('"x_request_id"')) ?? '{}');
    expect(line.x_request_id).toBe('jest-1');
    expect(line.data[1]).toEqual({ password: '***REDACTED***' });
    expect(line['logging.googleapis.com/sourceLocation'].file).toMatch(/logger\.test\.ts$/);
  });
});
