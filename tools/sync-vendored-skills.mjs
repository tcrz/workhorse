#!/usr/bin/env node
// Copies third-party skills listed in vendor.json into skills/<name>/, pinned to
// an exact upstream commit, together with the upstream LICENSE.
//
//   node tools/sync-vendored-skills.mjs            sync every skill at its pinned sha
//   node tools/sync-vendored-skills.mjs --update   move every pin to upstream HEAD, then sync
//
// Review the diff before committing: vendored skills run inside users' agents.
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(root, 'vendor.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const update = process.argv.includes('--update');

function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed:\n${result.stderr}`);
  }
  return result.stdout.trim();
}

const LICENSE_NAMES = ['LICENSE', 'LICENSE.md', 'LICENSE.txt'];

for (const skill of manifest.skills) {
  const url = `https://github.com/${skill.repo}.git`;
  const work = mkdtempSync(path.join(os.tmpdir(), `vendor-${skill.name}-`));
  try {
    git(work, ['init', '-q']);
    git(work, ['remote', 'add', 'origin', url]);
    if (update) {
      skill.sha = git(work, ['ls-remote', 'origin', 'HEAD']).split(/\s+/)[0];
    }
    git(work, ['sparse-checkout', 'set', '--no-cone', `/${skill.path}/`, ...LICENSE_NAMES.map((name) => `/${name}`)]);
    git(work, ['fetch', '-q', '--depth', '1', '--filter=blob:none', 'origin', skill.sha]);
    git(work, ['checkout', '-q', 'FETCH_HEAD']);

    const source = path.join(work, skill.path);
    if (!existsSync(path.join(source, 'SKILL.md'))) {
      throw new Error(`${skill.repo}@${skill.sha} has no ${skill.path}/SKILL.md`);
    }
    const license = LICENSE_NAMES.map((name) => path.join(work, name)).find((file) => existsSync(file));
    if (!license) {
      throw new Error(`${skill.repo}@${skill.sha} has no LICENSE at the repo root`);
    }

    const target = path.join(root, 'skills', skill.name);
    rmSync(target, { recursive: true, force: true });
    cpSync(source, target, { recursive: true });
    cpSync(license, path.join(target, 'LICENSE'));
    writeFileSync(path.join(target, 'VENDORED.md'),
      `# Vendored skill\n\nCopied unmodified from [${skill.repo}](https://github.com/${skill.repo}/tree/${skill.sha}/${skill.path}) at commit \`${skill.sha}\`.\n\nLicense: ${skill.license} — see [LICENSE](LICENSE). Don't edit files here; change \`vendor.json\` and run \`node tools/sync-vendored-skills.mjs\`.\n`);
    console.log(`synced ${skill.name} from ${skill.repo}@${skill.sha.slice(0, 12)} (${readdirSync(target).length} entries)`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (update) {
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log('vendor.json pins updated');
}
