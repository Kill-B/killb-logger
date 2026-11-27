export const REDACTED = '***REDACTED***';
export const CIRCULAR = '[Circular]';
export const MAX_DEPTH_REACHED = '[Max Depth]';
const MAX_DEPTH = 32;

/** A key is masked when its name contains one of these words, ignoring case. */
export const DEFAULT_MASKED_WORDS: readonly string[] = Object.freeze([
  'password',
  'passwd',
  'secret',
  'token',
  'authorization',
  'cookie',
  'apikey',
  'api_key',
  'api-key',
  'privatekey',
  'private_key',
  'signature',
  'cardnumber',
  'card_number',
  'cvv',
  'cvc',
  'securitycode',
  'ssn',
  'socialsecurity',
  'sessionid',
  'otp',
  'bearer',
  'creditcard',
]);

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };

function define(target: JsonObject, key: string, value: Json): void {
  // defineProperty, not assignment: a "__proto__" key must stay a plain property.
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
}

/**
 * Turns any value into a masked, JSON-safe clone. It never throws: whatever can't be read becomes REDACTED,
 * a reference back to an ancestor becomes CIRCULAR, and values JSON can't represent become text.
 */
export class Serializer {
  readonly #words: readonly string[];

  constructor(extraWords: readonly unknown[] = []) {
    const extra = extraWords
      .filter((word): word is string => typeof word === 'string' && word.trim() !== '')
      .map(word => word.trim().toLowerCase());
    this.#words = Object.freeze([...new Set([...DEFAULT_MASKED_WORDS, ...extra])]);
  }

  get words(): readonly string[] {
    return this.#words;
  }

  isSensitiveKey(key: string): boolean {
    const lower = key.toLowerCase();
    return this.#words.some(word => lower.includes(word));
  }

  toSafe(value: unknown): Json | undefined {
    return this.#walk(value, [], 0);
  }

  /** The `message` of a Cloud Logging line, from the original first argument and its safe clone. */
  messageOf(args: readonly unknown[], safeFirst: Json | undefined): string {
    if (args.length === 0) return '';
    const first = args[0];
    if (typeof first === 'string') return first;
    if (first === undefined) return '';
    try {
      if (first instanceof Error) return `${String(first.name)}: ${String(first.message)}`;
      return JSON.stringify(safeFirst) ?? '';
    } catch {
      return REDACTED;
    }
  }

  #walk(value: unknown, ancestors: readonly object[], depth: number): Json | undefined {
    try {
      switch (typeof value) {
        case 'string':
        case 'boolean':
          return value;
        case 'number':
          return Number.isFinite(value) ? value : String(value);
        case 'bigint':
          return value.toString();
        case 'symbol':
          return value.toString();
        case 'function':
          return `[Function: ${value.name || 'anonymous'}]`;
        case 'undefined':
          return undefined;
        default:
          break;
      }
      if (value === null) return null;
      const node = value as object;
      if (ancestors.includes(node)) return CIRCULAR;
      if (depth >= MAX_DEPTH) return MAX_DEPTH_REACHED;
      const path = [...ancestors, node];

      if (node instanceof Error) return this.#error(node, path, depth);
      if (node instanceof Date) return Number.isNaN(node.getTime()) ? null : node.toISOString();
      if (Array.isArray(node)) return node.map(item => this.#walk(item, path, depth + 1) ?? null);
      if (node instanceof Map) return this.#entries([...node.entries()], path, depth);
      if (node instanceof Set) return [...node.values()].map(item => this.#walk(item, path, depth + 1) ?? null);

      const toJSON = (node as { toJSON?: unknown }).toJSON;
      if (typeof toJSON === 'function') return this.#walk(toJSON.call(node), path, depth + 1) ?? null;

      return this.#entries(
        Object.keys(node).map(key => [key, undefined, node]),
        path,
        depth,
      );
    } catch {
      return REDACTED;
    }
  }

  /** Entries are [key, value] or [key, undefined, owner]: an owner means the value is read lazily, so a throwing getter only redacts its own key. */
  #entries(entries: readonly (readonly unknown[])[], path: readonly object[], depth: number): JsonObject {
    const out: JsonObject = {};
    for (const entry of entries) {
      const key = String(entry[0]);
      if (this.isSensitiveKey(key)) {
        define(out, key, REDACTED);
        continue;
      }
      let child: unknown;
      try {
        child = entry.length === 3 ? (entry[2] as Record<string, unknown>)[key] : entry[1];
      } catch {
        define(out, key, REDACTED);
        continue;
      }
      const safe = this.#walk(child, path, depth + 1);
      if (safe !== undefined) define(out, key, safe);
    }
    return out;
  }

  #error(error: Error, path: readonly object[], depth: number): JsonObject {
    const out: JsonObject = {};
    for (const key of ['name', 'message', 'stack'] as const) {
      try {
        const value: unknown = error[key];
        if (typeof value === 'string') define(out, key, value);
      } catch {
        define(out, key, REDACTED);
      }
    }

    const toJSON = (error as { toJSON?: unknown }).toJSON;
    let extra: Json | undefined;
    if (typeof toJSON === 'function') {
      // An error that describes itself (axios does) is trusted for its shape, not for its secrets: the result is walked and masked.
      try {
        extra = this.#walk(toJSON.call(error), path, depth + 1);
      } catch {
        extra = REDACTED;
      }
    } else {
      const keys = Object.keys(error).filter(key => key !== 'name' && key !== 'message' && key !== 'stack');
      extra = this.#entries(
        keys.map(key => [key, undefined, error]),
        path,
        depth,
      );
    }
    if (extra && typeof extra === 'object' && !Array.isArray(extra)) {
      for (const [key, value] of Object.entries(extra)) if (!(key in out)) define(out, key, value);
    } else if (extra !== undefined) {
      define(out, 'details', extra);
    }

    if ('cause' in error && !('cause' in out)) {
      let cause: unknown;
      try {
        cause = error.cause;
      } catch {
        cause = REDACTED;
      }
      const safe = this.#walk(cause, path, depth + 1);
      if (safe !== undefined) define(out, 'cause', safe);
    }
    return out;
  }
}
