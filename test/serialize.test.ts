import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CIRCULAR, DEFAULT_MASKED_WORDS, REDACTED, Serializer } from '../src/serialize.ts';

const serializer = new Serializer();
const safe = (value: unknown) => serializer.toSafe(value);

describe('masking (AC11)', () => {
  it('masks a listed key at depth 1, at depth 5, inside an array and on an error', () => {
    const error = Object.assign(new Error('failed'), { apiKey: 'k-123' });
    const input = {
      password: 'p-1',
      a: { b: { c: { d: { token: 't-5' } } } },
      list: [{ secret: 's-1' }, 'plain'],
      error,
    };
    const out = JSON.stringify(safe(input));
    for (const raw of ['p-1', 't-5', 's-1', 'k-123']) assert.ok(!out.includes(raw), `${raw} leaked`);
    assert.deepEqual(JSON.parse(out).a.b.c.d, { token: REDACTED });
    assert.deepEqual(JSON.parse(out).list, [{ secret: REDACTED }, 'plain']);
    assert.equal(JSON.parse(out).error.apiKey, REDACTED);
    assert.equal(JSON.parse(out).error.message, 'failed');
  });

  it('matches a listed word inside a key, in any case', () => {
    const out = safe({
      'X-Api-Key': 'a',
      userPassword: 'b',
      otpCode: 'c',
      Authorization: 'd',
      socialSecurityNumber: 'e',
    });
    assert.deepEqual(out, {
      'X-Api-Key': REDACTED,
      userPassword: REDACTED,
      otpCode: REDACTED,
      Authorization: REDACTED,
      socialSecurityNumber: REDACTED,
    });
  });

  it('masks every default word', () => {
    for (const word of DEFAULT_MASKED_WORDS) {
      assert.deepEqual(
        safe({ [`my_${word.toUpperCase()}_field`]: 'value' }),
        { [`my_${word.toUpperCase()}_field`]: REDACTED },
        word,
      );
    }
  });

  it('leaves the caller object unchanged', () => {
    const input = { password: 'p', nested: { token: 't' } };
    safe(input);
    assert.deepEqual(input, { password: 'p', nested: { token: 't' } });
  });

  it('masks words a consumer adds, and keeps the defaults whatever the settings say', () => {
    const custom = new Serializer(['document', '', 42, ' Iban ']);
    assert.deepEqual(custom.toSafe({ documentNumber: '1', ibanCode: '2', password: '3', other: '4' }), {
      documentNumber: REDACTED,
      ibanCode: REDACTED,
      password: REDACTED,
      other: '4',
    });
  });

  it('masks keys of a Map', () => {
    assert.deepEqual(
      safe(
        new Map<string, string>([
          ['clientSecret', 'x'],
          ['id', 'y'],
        ]),
      ),
      { clientSecret: REDACTED, id: 'y' },
    );
  });

  it('masks inside the output of an error toJSON (axios style)', () => {
    const error = Object.assign(new Error('Request failed'), {
      toJSON: () => ({ message: 'Request failed', config: { headers: { Authorization: 'Bearer abc' }, url: '/x' } }),
    });
    const out = safe(error) as Record<string, unknown>;
    assert.equal(out['name'], 'Error');
    assert.equal(typeof out['stack'], 'string');
    assert.deepEqual(out['config'], { headers: { Authorization: REDACTED }, url: '/x' });
  });
});

describe('values the masker cannot walk (AC16)', () => {
  it('redacts a throwing getter and keeps the rest', () => {
    const input = {
      ok: 1,
      get broken(): string {
        throw new Error('getter boom');
      },
    };
    assert.deepEqual(safe(input), { ok: 1, broken: REDACTED });
  });

  it('redacts a revoked proxy whole', () => {
    const { proxy, revoke } = Proxy.revocable({ password: 'raw-secret', id: 'raw-id' }, {});
    revoke();
    assert.equal(safe(proxy), REDACTED);
    assert.deepEqual(safe({ inner: proxy, ok: true }), { inner: REDACTED, ok: true });
  });

  it('redacts a proxy whose traps throw, with nothing raw in the output', () => {
    const target = { id: 'raw-value' };
    const hostile = new Proxy(target, {
      ownKeys() {
        throw new Error('no keys');
      },
    });
    const out = JSON.stringify(safe([hostile]));
    assert.ok(!out.includes('raw-value'));
    assert.deepEqual(JSON.parse(out), [REDACTED]);
  });

  it('redacts a toJSON that throws', () => {
    assert.equal(
      safe({
        toJSON() {
          throw new Error('nope');
        },
      }),
      REDACTED,
    );
  });
});

describe('circular references (AC18)', () => {
  it('writes the repeated branch of a self reference as [Circular]', () => {
    const node: Record<string, unknown> = { name: 'a' };
    node['self'] = node;
    assert.deepEqual(safe(node), { name: 'a', self: CIRCULAR });
  });

  it('handles an axios-style error whose request and response point to each other', () => {
    const request: Record<string, unknown> = { method: 'POST', path: '/hook' };
    const response: Record<string, unknown> = { status: 500, request };
    request['res'] = response;
    const error = Object.assign(new Error('connect ECONNREFUSED'), { request, response, code: 'ECONNREFUSED' });
    const out = safe(error) as {
      message: string;
      request: { res: { request: unknown } };
      response: { request: { res: unknown } };
    };
    assert.equal(out.message, 'connect ECONNREFUSED');
    assert.equal(out.request.res.request, CIRCULAR);
    assert.equal(out.response.request.res, CIRCULAR);
    assert.doesNotThrow(() => JSON.stringify(out));
  });

  it('writes a shared, non-circular reference in full each time', () => {
    const shared = { id: 1 };
    assert.deepEqual(safe({ a: shared, b: shared }), { a: { id: 1 }, b: { id: 1 } });
  });
});

describe('values JSON cannot represent (AC23)', () => {
  it('writes BigInt, function and symbol as text and drops undefined keys', () => {
    function namedFn() {}
    const out = safe({
      big: 123n,
      fn: namedFn,
      anon: (() => () => {})(),
      sym: Symbol('tag'),
      gone: undefined,
      kept: null,
    });
    assert.deepEqual(out, {
      big: '123',
      fn: '[Function: namedFn]',
      anon: '[Function: anonymous]',
      sym: 'Symbol(tag)',
      kept: null,
    });
  });

  it('writes non-finite numbers and dates as text', () => {
    assert.deepEqual(safe({ n: Number.NaN, i: Infinity, d: new Date(0), bad: new Date('x') }), {
      n: 'NaN',
      i: 'Infinity',
      d: '1970-01-01T00:00:00.000Z',
      bad: null,
    });
  });

  it('keeps a __proto__ key as a plain property', () => {
    const input = JSON.parse('{"__proto__": {"polluted": true}, "ok": 1}') as object;
    const out = safe(input) as Record<string, unknown>;
    assert.equal(Object.getPrototypeOf(out), Object.prototype);
    assert.deepEqual(JSON.parse(JSON.stringify(out)), { ['__proto__']: { polluted: true }, ok: 1 });
  });
});

describe('message (AC6)', () => {
  const message = (...args: unknown[]) => serializer.messageOf(args, serializer.toSafe(args[0]));

  it('is the string itself', () => assert.equal(message('hello', { a: 1 }), 'hello'));
  it('is empty with no arguments or an undefined first argument', () => {
    assert.equal(message(), '');
    assert.equal(message(undefined, 'x'), '');
  });
  it('is "null" for null', () => assert.equal(message(null), 'null'));
  it('is the JSON text of an object or number', () => {
    assert.equal(message({ a: 1 }), '{"a":1}');
    assert.equal(message(5), '5');
  });
  it('is "<name>: <message>" for an error', () =>
    assert.equal(message(new TypeError('bad input')), 'TypeError: bad input'));
  it('uses the masked, cycle-safe text for circular, masked and BigInt values', () => {
    const node: Record<string, unknown> = { token: 'raw', n: 1n };
    node['self'] = node;
    assert.equal(message(node), `{"token":"${REDACTED}","n":"1","self":"${CIRCULAR}"}`);
  });
});
