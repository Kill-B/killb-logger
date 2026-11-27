export type HeaderValue = string | string[] | undefined;
export type Headers = Readonly<Record<string, HeaderValue>>;

const TRACEPARENT = /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;
const CLOUD_TRACE_CONTEXT = /^([0-9a-fA-F]{32})(?:\/\d+)?(?:;o=[0-9]+)?$/;
const ZERO_TRACE_ID = '0'.repeat(32);

function readHeader(headers: Headers, name: string): string | undefined {
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() !== name) continue;
    const value = headers[key];
    const first = Array.isArray(value) ? value[0] : value;
    return typeof first === 'string' ? first.trim() : undefined;
  }
  return undefined;
}

export function traceIdFromTraceparent(value: string | undefined): string | undefined {
  const match = value ? TRACEPARENT.exec(value.toLowerCase()) : null;
  if (!match) return undefined;
  const [, version, traceId, spanId] = match;
  if (version === 'ff' || traceId === ZERO_TRACE_ID || spanId === '0'.repeat(16)) return undefined;
  return traceId;
}

export function traceIdFromCloudTraceContext(value: string | undefined): string | undefined {
  const match = value ? CLOUD_TRACE_CONTEXT.exec(value) : null;
  if (!match?.[1]) return undefined;
  const traceId = match[1].toLowerCase();
  return traceId === ZERO_TRACE_ID ? undefined : traceId;
}

/** `traceparent` wins; a missing or malformed one falls back to `X-Cloud-Trace-Context`. Never throws. */
export function traceIdFromHeaders(headers: unknown): string | undefined {
  try {
    if (!headers || typeof headers !== 'object') return undefined;
    const map = headers as Headers;
    return (
      traceIdFromTraceparent(readHeader(map, 'traceparent')) ??
      traceIdFromCloudTraceContext(readHeader(map, 'x-cloud-trace-context'))
    );
  } catch {
    return undefined;
  }
}

interface TraceAgent {
  getCurrentContextId?: () => unknown;
  getWriterProjectId?: () => unknown;
}

function traceAgent(): TraceAgent | undefined {
  const agent: unknown = (globalThis as { _google_trace_agent?: unknown })._google_trace_agent;
  return agent && typeof agent === 'object' ? agent : undefined;
}

function callString(fn: (() => unknown) | undefined): string | undefined {
  try {
    const value = fn?.();
    return typeof value === 'string' && value ? value : undefined;
  } catch {
    return undefined;
  }
}

export function agentTraceId(): string | undefined {
  const agent = traceAgent();
  return callString(agent?.getCurrentContextId?.bind(agent));
}

export function resolveProjectId(option: string | undefined): string | undefined {
  if (option) return option;
  const env = process.env['GOOGLE_CLOUD_PROJECT'] || process.env['GCP_PROJECT'];
  if (env) return env;
  const agent = traceAgent();
  return callString(agent?.getWriterProjectId?.bind(agent));
}

export function cloudTrace(traceId: string | undefined, projectId: string | undefined): string | null {
  return traceId && projectId ? `projects/${projectId}/traces/${traceId}` : null;
}
