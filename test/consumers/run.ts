import { execFileSync } from 'node:child_process';
import { readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Packs the package as npm would publish it, installs the tarball into each consumer project here, and runs its test.
// Usage: node test/consumers/run.ts [fixture…]
const here = import.meta.dirname;
const root = join(here, '..', '..');
const only = process.argv.slice(2);
const fixtures = readdirSync(here).filter(
  name => statSync(join(here, name)).isDirectory() && (only.length === 0 || only.includes(name)),
);

const run = (command: string, args: string[], cwd: string) => execFileSync(command, args, { cwd, stdio: 'inherit' });

run('npm', ['run', 'build'], root);
const output = execFileSync('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', here], {
  cwd: root,
  encoding: 'utf8',
});
const [{ filename }] = JSON.parse(output) as [{ filename: string }];
renameSync(join(here, filename), join(here, 'killb-logger.tgz'));

for (const fixture of fixtures) {
  const dir = join(here, fixture);
  console.log(`\n== consumer: ${fixture} (node ${process.version})`);
  rmSync(join(dir, 'node_modules'), { recursive: true, force: true });
  run('npm', ['install', '--no-audit', '--no-fund', '--no-package-lock', '--ignore-scripts'], dir);
  run('npm', ['test'], dir);
}
