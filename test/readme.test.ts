import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, it } from 'node:test';

import { DEFAULT_MASKED_WORDS } from '../src/serialize.ts';

const root = join(import.meta.dirname, '..');
const readme = readFileSync(join(root, 'README.md'), 'utf8');

describe('README (AC20)', () => {
  it('has the required sections', () => {
    for (const heading of [
      '## Express setup',
      '## NestJS setup',
      '## Pub/Sub consumer context',
      '## Settings',
      '## Cloud Logging line shape',
      '## Masking',
    ]) {
      assert.ok(readme.includes(`\n${heading}\n`), `missing ${heading}`);
    }
  });

  it('documents every setting and every default masked word', () => {
    for (const setting of [
      '`name`',
      '`minLevel`',
      '`displayRequestId`',
      '`suppressStdOutput`',
      '`mask.keys`',
      '`transports`',
      '`provider`',
      '`enabled`',
      '`options.projectId`',
    ]) {
      assert.ok(readme.includes(setting), `missing setting ${setting}`);
    }
    for (const word of DEFAULT_MASKED_WORDS) assert.ok(readme.includes(`\`${word}\``), `missing word ${word}`);
  });

  it('holds no internal details anywhere in the repo', () => {
    // This file is left out of the search: it has to spell the patterns.
    const denied = [
      new RegExp(['K', 'IL-\\d+'].join(''), 'i'),
      new RegExp(['taran', 'tino'].join(''), 'i'),
      new RegExp(['serve', 'less'].join(''), 'i'),
      new RegExp(['killb', '-hub'].join(''), 'i'),
      new RegExp(['linear', '\\.app'].join(''), 'i'),
      new RegExp(['\\.run', '\\.app'].join(''), 'i'),
      new RegExp(['apigate', 'way'].join(''), 'i'),
      new RegExp(['\\.internal', '\\b'].join(''), 'i'),
      new RegExp(['killb', '\\.app'].join(''), 'i'),
    ];
    const skip = new Set(['node_modules', 'dist', '.git', 'package-lock.json']);
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        if (skip.has(entry) || entry.endsWith('.tgz')) continue;
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) walk(path);
        else if (path !== import.meta.filename) files.push(path);
      }
    };
    walk(root);
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      for (const pattern of denied) assert.ok(!pattern.test(text), `${relative(root, file)} matches ${pattern}`);
    }
  });
});
