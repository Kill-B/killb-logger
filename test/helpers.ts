export interface CloudLine {
  severity: string;
  message: string;
  data: unknown[];
  x_request_id: string;
  'logging.googleapis.com/sourceLocation': { file: string; line: string; function: string };
  'logging.googleapis.com/trace': string | null;
}

export interface Captured {
  stdout: CloudLine[];
  stderr: CloudLine[];
  /** Every Cloud Logging line, in write order. */
  lines: CloudLine[];
  /** Pretty terminal lines (tslog), in write order. */
  pretty: string[];
}

const PRETTY_LINE = /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d{3}\t/;
const CLOUD_KEY = '"logging.googleapis.com/sourceLocation"';

type Write = typeof process.stdout.write;

/**
 * Captures what the logger writes while `fn` runs: Cloud Logging JSON lines per stream and pretty lines.
 * Anything else (the test runner's own output) passes through untouched.
 */
export async function capture(fn: () => unknown): Promise<Captured> {
  const captured: Captured = { stdout: [], stderr: [], lines: [], pretty: [] };
  const originals: Record<'stdout' | 'stderr', Write> = {
    stdout: process.stdout.write.bind(process.stdout),
    stderr: process.stderr.write.bind(process.stderr),
  };
  let prettyOpen = false;

  const intercept =
    (stream: 'stdout' | 'stderr'): Write =>
    (chunk: unknown, ...rest: unknown[]) => {
      const text = typeof chunk === 'string' ? chunk : Buffer.from(chunk as Uint8Array).toString('utf8');
      let ours = false;
      for (const line of text.split('\n')) {
        if (line.includes(CLOUD_KEY)) {
          const parsed = JSON.parse(line) as CloudLine;
          captured[stream].push(parsed);
          captured.lines.push(parsed);
          prettyOpen = false;
          ours = true;
        } else if (PRETTY_LINE.test(line)) {
          captured.pretty.push(line);
          prettyOpen = true;
          ours = true;
        } else if (prettyOpen && line !== '') {
          captured.pretty[captured.pretty.length - 1] += `\n${line}`;
          ours = true;
        }
      }
      if (ours) return true;
      return (originals[stream] as (...args: unknown[]) => boolean)(chunk, ...rest);
    };

  process.stdout.write = intercept('stdout');
  process.stderr.write = intercept('stderr');
  try {
    await fn();
  } finally {
    process.stdout.write = originals.stdout;
    process.stderr.write = originals.stderr;
  }
  return captured;
}

/** The line number of the code that calls this function. */
export function callerLine(): number {
  const frame = new Error().stack?.split('\n')[2] ?? '';
  return Number(/:(\d+):\d+\)?$/.exec(frame)?.[1] ?? -1);
}

export const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
