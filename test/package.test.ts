import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const root = join(import.meta.dirname, '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as Record<string, unknown>;
const built = existsSync(join(root, 'dist', 'index.cjs'));

describe('package (AC2)', () => {
  it('declares no runtime dependency and Node 22 or later', () => {
    for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies', 'bundleDependencies']) {
      assert.equal(pkg[field], undefined, `${field} must be empty`);
    }
    assert.deepEqual(pkg['engines'], { node: '>=22' });
  });

  it('ships tslog’s MIT license notice', () => {
    const notices = readFileSync(join(root, 'THIRD_PARTY_NOTICES.md'), 'utf8');
    assert.match(notices, /## tslog /);
    assert.match(notices, /MIT License/);
    assert.match(notices, /Permission is hereby granted, free of charge/);
  });

  it(
    'packs the builds, their types, the license and the notices',
    { skip: !built && 'run npm run build first' },
    () => {
      const output = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
        cwd: root,
        encoding: 'utf8',
      });
      const files = (JSON.parse(output) as [{ files: { path: string }[] }])[0].files.map(file => file.path).sort();
      assert.deepEqual(files, [
        'LICENSE',
        'README.md',
        'THIRD_PARTY_NOTICES.md',
        'dist/index.cjs',
        'dist/index.d.cts',
        'dist/index.d.ts',
        'dist/index.js',
        'package.json',
      ]);
    },
  );

  it('bundles tslog and references no Express types (AC27)', { skip: !built && 'run npm run build first' }, () => {
    for (const file of ['index.cjs', 'index.js']) {
      const code = readFileSync(join(root, 'dist', file), 'utf8');
      const importsTslog = /require\(["']tslog["']\)|^\s*import\s[^\n]*from ["']tslog["']/m;
      assert.ok(!importsTslog.test(code), `${file} still imports tslog`);
    }
    for (const file of ['index.d.ts', 'index.d.cts']) {
      const types = readFileSync(join(root, 'dist', file), 'utf8');
      const expressTypes =
        /from ["'](?:express|@types\/express)|import\(["'](?:express|@types\/express)|types=["']express/;
      assert.ok(!expressTypes.test(types), `${file} references Express types`);
      assert.ok(!/from ["']tslog["']/.test(types), `${file} imports tslog types`);
    }
  });
});
