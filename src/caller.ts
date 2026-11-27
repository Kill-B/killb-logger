import { readFileSync } from 'node:fs';
import { findSourceMap, SourceMap, type SourceMapPayload } from 'node:module';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface SourceLocation {
  file: string;
  line: string;
  function: string;
}

const UNKNOWN: SourceLocation = Object.freeze({ file: 'unknown', line: '0', function: 'anonymous' });
const FRAME = /^\s*at (?:async )?(?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/;

function toPath(file: string): string {
  if (!file.startsWith('file://')) return file;
  try {
    return fileURLToPath(file);
  } catch {
    return file;
  }
}

function displayPath(file: string): string {
  const path = toPath(file);
  if (!isAbsolute(path)) return path;
  const fromCwd = relative(process.cwd(), path);
  return fromCwd.startsWith('..') ? path : fromCwd;
}

function functionName(raw: string | undefined): string {
  if (!raw) return 'anonymous';
  const name = raw.replace(/^new /, '').replace(/ \[as [^\]]+\]$/, '');
  const last = name.slice(name.lastIndexOf('.') + 1);
  return !last || last === '<anonymous>' ? 'anonymous' : last;
}

interface Origin {
  file: string;
  line: number;
}

interface LoadedMap {
  map: SourceMap;
  dir: string;
  sourceRoot: string;
}

const MAX_CACHED_MAPS = 1000;
const maps = new Map<string, LoadedMap | null>();
const MAPPING_URL = /\/\/[#@] sourceMappingURL=(\S+)\s*$/;
const DATA_URL = /^data:application\/json;(?:charset=utf-8;)?base64,/;

/** Reads the compiled file's own source map, so positions map back without `--enable-source-maps`. Cached per file. */
function loadMap(path: string): LoadedMap | undefined {
  const cached = maps.get(path);
  if (cached !== undefined) return cached ?? undefined;
  let loaded: LoadedMap | null = null;
  try {
    const code = readFileSync(path, 'utf8');
    const url = MAPPING_URL.exec(code.slice(code.lastIndexOf('//# sourceMappingURL=')))?.[1];
    if (url) {
      const mapPath = DATA_URL.test(url) ? path : resolve(dirname(path), url);
      const json = DATA_URL.test(url)
        ? Buffer.from(url.replace(DATA_URL, ''), 'base64').toString('utf8')
        : readFileSync(mapPath, 'utf8');
      const payload = JSON.parse(json) as SourceMapPayload;
      loaded = { map: new SourceMap(payload), dir: dirname(mapPath), sourceRoot: payload.sourceRoot ?? '' };
    }
  } catch {
    loaded = null;
  }
  if (maps.size >= MAX_CACHED_MAPS) maps.clear();
  maps.set(path, loaded);
  return loaded ?? undefined;
}

/** Maps a compiled position back to its source when the compiled file has a source map. */
function original(file: string, line: number, column: number): Origin | undefined {
  try {
    if (findSourceMap(file) ?? findSourceMap(toPath(file))) return undefined; // The runtime already mapped the stack.
    const path = toPath(file);
    if (!isAbsolute(path)) return undefined;
    const loaded = loadMap(path);
    if (!loaded) return undefined;
    const origin = loaded.map.findOrigin(line, column) as { fileName?: string; lineNumber?: number };
    if (!origin.fileName || !origin.lineNumber) return undefined;
    const source = toPath(origin.fileName);
    return {
      file: isAbsolute(source) ? source : resolve(loaded.dir, loaded.sourceRoot, source),
      line: origin.lineNumber,
    };
  } catch {
    return undefined;
  }
}

/** The location of the code that called `skip`. Never throws. */
export function callerLocation(skip: (...args: never[]) => unknown): SourceLocation {
  const limit = Error.stackTraceLimit;
  try {
    Error.stackTraceLimit = 1;
    const holder: { stack?: string } = {};
    Error.captureStackTrace(holder, skip);
    const frame = holder.stack?.split('\n').find(text => text.trimStart().startsWith('at '));
    const match = frame ? FRAME.exec(frame) : null;
    if (!match?.[2] || !match[3] || !match[4]) return UNKNOWN;
    const line = Number(match[3]);
    const mapped = original(match[2], line, Number(match[4]));
    return {
      file: displayPath(mapped?.file ?? match[2]),
      line: String(mapped?.line ?? line),
      function: functionName(match[1]),
    };
  } catch {
    return UNKNOWN;
  } finally {
    Error.stackTraceLimit = limit;
  }
}
