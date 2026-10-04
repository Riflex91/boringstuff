import { existsSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const candidates = [
  resolve(here, '..', 'game'),
  resolve(here, '..')
];

const gameDir = candidates.find(dir => existsSync(resolve(dir, 'main.js')));
if (!gameDir) {
  console.error('Could not locate Screeps runtime modules. Checked:\n' + candidates.map(dir => '  ' + dir).join('\n'));
  process.exit(1);
}

const files = readdirSync(gameDir).filter(name => name.endsWith('.js')).sort();
if (!files.length) {
  console.error(`No JavaScript runtime modules found in ${gameDir}`);
  process.exit(1);
}

for (const name of files) {
  const full = resolve(gameDir, name);
  const result = spawnSync(process.execPath, ['--check', full], { encoding: 'utf8' });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout || `syntax check failed: ${name}\n`);
    process.exit(result.status || 1);
  }
}
console.log(`game syntax checks passed (${files.length} modules)`);
