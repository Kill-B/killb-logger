import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { Logger } from '../src/index.ts';
import { resolveProjectId, traceIdFromHeaders } from '../src/trace.ts';
import { capture } from './helpers.ts';

const CLOUD = '105445aa7843bc8bf206b12000100000';
const W3C = '0af7651916cd43dd8448eb211c80319c';
const cloudHeader = `${CLOUD}/1;o=1`;
const traceparent = `00-${W3C}-b7ad6b7169203331-01`;

const saved = { google: process.env['GOOGLE_CLOUD_PROJECT'], gcp: process.env['GCP_PROJECT'] };
const globalAgent = globalThis as { _google_trace_agent?: unknown };

beforeEach(() => {
  delete process.env['GOOGLE_CLOUD_PROJECT'];
  delete process.env['GCP_PROJECT'];
  delete globalAgent._google_trace_agent;
});

afterEach(() => {
  for (const [key, value] of [
    ['GOOGLE_CLOUD_PROJECT', saved.google],
    ['GCP_PROJECT', saved.gcp],
  ] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  delete globalAgent._google_trace_agent;
});

describe('trace id from headers (AC10)', () => {
  it('reads X-Cloud-Trace-Context', () =>
    assert.equal(traceIdFromHeaders({ 'x-cloud-trace-context': cloudHeader }), CLOUD));
  it('reads traceparent', () => assert.equal(traceIdFromHeaders({ traceparent }), W3C));
  it('prefers traceparent when both are present', () =>
    assert.equal(traceIdFromHeaders({ traceparent, 'x-cloud-trace-context': cloudHeader }), W3C));
  it('falls back to X-Cloud-Trace-Context when traceparent is malformed', () =>
    assert.equal(traceIdFromHeaders({ traceparent: '00-nothex-01', 'x-cloud-trace-context': cloudHeader }), CLOUD));
  it('looks the header up in any case and takes the first of a list', () =>
    assert.equal(traceIdFromHeaders({ 'X-Cloud-Trace-Context': [cloudHeader, 'other'] }), CLOUD));
  it('rejects malformed and all-zero ids, and never throws', () => {
    for (const headers of [
      {},
      { traceparent: `ff-${W3C}-b7ad6b7169203331-01` },
      { traceparent: `00-${'0'.repeat(32)}-b7ad6b7169203331-01` },
      { 'x-cloud-trace-context': 'not-a-trace' },
      { 'x-cloud-trace-context': `${'0'.repeat(32)}/1` },
      { traceparent: 42 },
      null,
      'headers',
    ]) {
      assert.equal(traceIdFromHeaders(headers), undefined, JSON.stringify(headers));
    }
  });
});

describe('project resolution (AC22)', () => {
  it('uses the option, then GOOGLE_CLOUD_PROJECT, then GCP_PROJECT, then the trace agent', () => {
    globalAgent._google_trace_agent = { getWriterProjectId: () => 'from-agent' };
    assert.equal(resolveProjectId(undefined), 'from-agent');
    process.env['GCP_PROJECT'] = 'from-gcp-project';
    assert.equal(resolveProjectId(undefined), 'from-gcp-project');
    process.env['GOOGLE_CLOUD_PROJECT'] = 'from-google-cloud-project';
    assert.equal(resolveProjectId(undefined), 'from-google-cloud-project');
    assert.equal(resolveProjectId('from-option'), 'from-option');
  });

  it('is undefined with none of them, and an agent that throws is ignored', () => {
    assert.equal(resolveProjectId(undefined), undefined);
    globalAgent._google_trace_agent = {
      getWriterProjectId: () => {
        throw new Error('agent down');
      },
    };
    assert.equal(resolveProjectId(undefined), undefined);
  });
});

describe('trace field on the Cloud Logging line (AC10, AC22)', () => {
  const lineFor = async (headers: Record<string, string>, projectId?: string) => {
    const logger = new Logger({
      name: 'trace-test',
      suppressStdOutput: true,
      transports: [{ provider: 'gcpLogging', enabled: true, ...(projectId ? { options: { projectId } } : {}) }],
    });
    const { lines } = await capture(() => {
      let reached = false;
      logger.setContextMiddleware({ headers }, {}, () => {
        reached = true;
        logger.info('x');
      });
      assert.ok(reached, 'the request goes on');
    });
    return lines[0]?.['logging.googleapis.com/trace'];
  };

  it('writes projects/<project>/traces/<id>', async () => {
    assert.equal(await lineFor({ 'x-cloud-trace-context': cloudHeader }, 'p1'), `projects/p1/traces/${CLOUD}`);
    assert.equal(await lineFor({ traceparent }, 'p1'), `projects/p1/traces/${W3C}`);
    assert.equal(
      await lineFor({ traceparent, 'x-cloud-trace-context': cloudHeader }, 'p1'),
      `projects/p1/traces/${W3C}`,
    );
  });

  it('takes the project from the environment when there is no option', async () => {
    process.env['GOOGLE_CLOUD_PROJECT'] = 'env-project';
    assert.equal(await lineFor({ traceparent }), `projects/env-project/traces/${W3C}`);
  });

  it('is null with no header, no project or a malformed header', async () => {
    assert.equal(await lineFor({}, 'p1'), null);
    assert.equal(await lineFor({ traceparent }), null);
    assert.equal(await lineFor({ traceparent: 'garbage' }, 'p1'), null);
  });

  it('uses the trace agent current trace when no header gave one', async () => {
    globalAgent._google_trace_agent = {
      getCurrentContextId: () => 'agent-trace',
      getWriterProjectId: () => 'agent-project',
    };
    assert.equal(await lineFor({}), 'projects/agent-project/traces/agent-trace');
  });
});
