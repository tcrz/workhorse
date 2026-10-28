import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { access, chmod, copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SKILL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const TEMPLATE_DIR = path.join(SKILL_ROOT, 'templates');
export const SUBSYSTEMS = ['instructions', 'state', 'verification', 'scope', 'lifecycle'];

export function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      args._.push(token);
      continue;
    }
    const [rawKey, inlineValue] = token.slice(2).split('=', 2);
    const key = rawKey.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    if (inlineValue !== undefined) {
      args[key] = inlineValue;
    } else if (argv[i + 1] && !argv[i + 1].startsWith('--')) {
      args[key] = argv[i + 1];
      i += 1;
    } else {
      args[key] = true;
    }
  }
  return args;
}

export async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function readText(filePath) {
  return readFile(filePath, 'utf8');
}

export async function readJson(filePath) {
  return JSON.parse(await readText(filePath));
}

export async function writeText(filePath, contents) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, contents, 'utf8');
}

export async function copyTemplate(templateName, targetPath, replacements = {}, { force = false } = {}) {
  if (!force && await exists(targetPath)) {
    return { path: targetPath, status: 'skipped', reason: 'exists' };
  }

  let contents = await readText(path.join(TEMPLATE_DIR, templateName));
  contents = contents.replace(/\r\n/g, '\n');
  for (const [key, value] of Object.entries(replacements)) {
    contents = contents.split(`{{${key}}}`).join(value);
  }
  await writeText(targetPath, contents);
  if (templateName.endsWith('.sh')) {
    await chmod(targetPath, 0o755);
  }
  return { path: targetPath, status: 'written' };
}

/**
 * Normalize a branch ref to a bare name (strip remotes / refs/heads/).
 * @param {string} ref
 * @returns {string}
 */
export function normalizeBranchName(ref) {
  let name = String(ref || '').trim();
  if (!name) return '';
  name = name.replace(/^refs\/heads\//, '');
  name = name.replace(/^refs\/remotes\//, '');
  name = name.replace(/^remotes\//, '');
  name = name.replace(/^(origin|upstream)\//, '');
  return name;
}

/**
 * Resolve the remote's default branch (origin/HEAD) — the default PR target.
 * Does not fetch. Returns '' when the repo has no origin/HEAD.
 * @param {string} repoRoot
 * @returns {string}
 */
export function detectDefaultBranch(repoRoot) {
  if (!repoRoot || !existsSync(path.join(repoRoot, '.git'))) return '';
  const result = spawnSync('git', ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], {
    cwd: repoRoot,
    encoding: 'utf8'
  });
  if (result.status !== 0) return '';
  return normalizeBranchName(String(result.stdout || '').trim());
}

/** Read the origin remote URL ('' when absent). */
export function readOriginUrl(repoRoot) {
  if (!repoRoot || !existsSync(path.join(repoRoot, '.git'))) return '';
  const result = spawnSync('git', ['remote', 'get-url', 'origin'], { cwd: repoRoot, encoding: 'utf8' });
  return result.status === 0 ? String(result.stdout || '').trim() : '';
}

/**
 * Validate a proposed integrationBranch value for scaffold/upgrade.
 * @param {string} value
 * @returns {{ ok: true, name: string } | { ok: false, error: string }}
 */
export function assertIntegrationBranch(value) {
  const name = normalizeBranchName(value);
  if (!name) {
    return { ok: false, error: 'integrationBranch must be a non-empty bare branch name (e.g. main)' };
  }
  if (/\s/.test(name)) {
    return { ok: false, error: `integrationBranch must not contain whitespace (got "${name}")` };
  }
  return { ok: true, name };
}

export const DEFAULT_BRANCH_PATTERN = 'feature/<short-desc>';
export const PR_HOSTS = ['github', 'gitlab', 'azure', 'none'];

/** Turn a branchPattern like `feature/<short-desc>` into an anchored RegExp. */
export function branchPatternToRegExp(pattern) {
  const source = String(pattern || DEFAULT_BRANCH_PATTERN)
    .split(/(<[^>]+>)/)
    .map((part) => (/^<[^>]+>$/.test(part) ? '[^/]+' : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    .join('');
  return new RegExp(`^${source}$`);
}

/** Derive the PR host from a git remote URL. */
export function detectPrHost(remoteUrl) {
  const url = String(remoteUrl || '').toLowerCase();
  if (url.includes('github.com')) return 'github';
  if (url.includes('gitlab')) return 'gitlab';
  if (url.includes('dev.azure.com') || url.includes('visualstudio.com')) return 'azure';
  return 'none';
}

export async function buildFeatureList(
  templateName,
  { approvalMode = 'supervised', integrationBranch, branchPattern = DEFAULT_BRANCH_PATTERN, prHost } = {}
) {
  const parsed = JSON.parse(await readText(path.join(TEMPLATE_DIR, templateName)));
  // Drop template-provided config keys so the caller's choices win and key order is stable.
  const rest = { ...parsed };
  delete rest.approvalMode;
  delete rest.integrationBranch;
  delete rest.branchPattern;
  delete rest.prHost;
  const asserted = assertIntegrationBranch(integrationBranch);
  if (!asserted.ok) {
    throw new Error(asserted.error);
  }
  const config = { approvalMode, integrationBranch: asserted.name, branchPattern };
  if (prHost) config.prHost = prHost;
  return `${JSON.stringify({ ...config, ...rest }, null, 2)}\n`;
}

export function detectPackageManager(root, explicit, appDir = '.') {
  if (explicit) return explicit;
  const dirs = appDir && appDir !== '.' ? [root, path.join(root, appDir)] : [root];
  for (const dir of dirs) {
    if (existsSync(path.join(dir, 'bun.lockb')) || existsSync(path.join(dir, 'bun.lock'))) return 'bun';
    if (existsSync(path.join(dir, 'pnpm-lock.yaml'))) return 'pnpm';
    if (existsSync(path.join(dir, 'yarn.lock'))) return 'yarn';
    if (existsSync(path.join(dir, 'package-lock.json'))) return 'npm';
  }
  return 'npm';
}

const APP_DIR_CANDIDATES = ['src', 'app', 'web', 'frontend', 'client'];

export function detectAppDir(files) {
  if (files.includes('package.json')) return '.';
  for (const candidate of APP_DIR_CANDIDATES) {
    if (files.includes(`${candidate}/package.json`)) return candidate;
  }
  const nested = files.filter((file) => file.endsWith('/package.json'));
  if (nested.length === 0) return '.';
  nested.sort((a, b) => a.split('/').length - b.split('/').length || a.length - b.length);
  return path.posix.dirname(nested[0]);
}

export async function detectProject(root) {
  const files = await listFiles(root, { maxFiles: 800 });
  const has = (name) => files.some((file) => file === name || file.endsWith(`/${name}`));
  const hasPrefix = (prefix) => files.some((file) => file.startsWith(prefix));
  const appDir = detectAppDir(files);
  const packageJsonRel = appDir === '.' ? 'package.json' : `${appDir}/package.json`;
  const packageJsonPath = path.join(root, packageJsonRel);
  const packageJson = await exists(packageJsonPath).then((ok) => ok ? readJson(packageJsonPath) : null);

  let stack = 'generic';
  let uiFramework = null;
  if (packageJson) {
    const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };
    // React (incl. Next.js) takes precedence over Vue when both appear.
    const hasReact = Boolean(deps.react || deps.next || hasPrefix('src/renderer'));
    // Vue signals: vue, Nuxt, or any *.vue single-file component.
    const hasVue = Boolean(deps.vue || deps.nuxt || files.some((file) => file.endsWith('.vue')));
    if (hasReact) {
      stack = 'typescript-react';
      uiFramework = 'react';
    } else if (hasVue) {
      stack = 'typescript-vue';
      uiFramework = 'vue';
    } else if (deps.typescript || has('tsconfig.json')) {
      stack = 'typescript';
    } else {
      stack = 'node';
    }
  } else if (has('pyproject.toml') || has('requirements.txt')) {
    stack = 'python';
  } else if (has('go.mod')) {
    stack = 'go';
  } else if (has('Cargo.toml')) {
    stack = 'rust';
  } else if (has('pom.xml')) {
    stack = 'java-maven';
  } else if (has('build.gradle') || has('build.gradle.kts')) {
    stack = 'java-gradle';
  } else if (files.some((file) => file.endsWith('.csproj') || file.endsWith('.sln'))) {
    stack = 'dotnet';
  }

  return {
    root,
    stack,
    uiFramework,
    frontend: uiFramework !== null,
    appDir,
    packageJson,
    files,
    packageManager: detectPackageManager(root, undefined, appDir)
  };
}

/** Conventional Commits — the set of allowed commit types. */
export const CONVENTIONAL_COMMIT_TYPES = [
  'feat', 'fix', 'refactor', 'chore', 'docs', 'test', 'perf', 'build', 'ci', 'style', 'revert'
];

const CONVENTIONAL_COMMIT_SUBJECT_PATTERN = new RegExp(
  `^(${CONVENTIONAL_COMMIT_TYPES.join('|')})(?:\\([^)]+\\))?!?:\\s.+$`
);
const TASKS_TRAILER_PATTERN = /^Tasks:\s+task-\d+(\s+task-\d+)*\s*$/;
const COMMIT_BODY_MAX = 300;

/**
 * Parse a commit message into { subject, body, trailer } and validate it against the
 * Conventional Commits + `Tasks:` trailer contract. Returns { ok, errors, warnings, parts }.
 * Trailer-less commits are allowed (remediation and CI-fix commits); feature-shaped types
 * without one get a soft warning.
 */
export function validateCommitMessage(message) {
  const errors = [];
  const warnings = [];
  const raw = String(message || '').replace(/\r\n/g, '\n').trim();
  if (!raw) {
    return { ok: false, errors: ['commit message is empty'], warnings, parts: null };
  }
  const lines = raw.split('\n');
  const subject = lines[0];
  // Trailer: last non-empty line matching the Tasks: pattern.
  let trailerIndex = -1;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (lines[i].trim() === '') continue;
    if (TASKS_TRAILER_PATTERN.test(lines[i])) trailerIndex = i;
    break;
  }
  const trailer = trailerIndex >= 0 ? lines[trailerIndex] : null;
  const bodyLines = trailer
    ? lines.slice(1, trailerIndex).filter((line, idx, arr) => !(idx === 0 && line === '') && !(idx === arr.length - 1 && line === ''))
    : lines.slice(1).filter((line) => line !== '');
  const body = bodyLines.join('\n').trim();

  if (!CONVENTIONAL_COMMIT_SUBJECT_PATTERN.test(subject)) {
    errors.push(`commit subject must follow Conventional Commits (\`<type>: <summary>\`). Got: "${subject}"`);
  }
  if (subject.length > 72) {
    warnings.push(`commit subject is ${subject.length} chars; keep it ≤ 72`);
  }
  if (body.length > COMMIT_BODY_MAX) {
    warnings.push(`commit body is ${body.length} chars; keep it ≤ ${COMMIT_BODY_MAX} (a slightly detailed summary, not a full changelog)`);
  }
  if (!trailer && /^(feat|fix|refactor|perf)/.test(subject)) {
    warnings.push('commit has no `Tasks: task-NNN …` trailer; feature commits list every task id in the feature');
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    parts: { subject, body, trailer }
  };
}

export async function listFiles(root, { maxFiles = 1000 } = {}) {
  const ignored = new Set(['.git', 'node_modules', 'dist', 'build', '.next', '.venv', 'venv', '__pycache__']);
  const results = [];

  async function walk(current, relative) {
    if (results.length >= maxFiles) return;
    let entries = [];
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (results.length >= maxFiles) return;
      if (ignored.has(entry.name)) continue;
      const rel = relative ? `${relative}/${entry.name}` : entry.name;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full, rel);
      } else if (entry.isFile()) {
        results.push(rel);
      }
    }
  }

  await walk(root, '');
  return results.sort();
}

export function pmDirFlag(pm, appDir) {
  if (!appDir || appDir === '.') return '';
  if (pm === 'pnpm') return ` --dir ${appDir}`;
  if (pm === 'npm') return ` --prefix ${appDir}`;
  if (pm === 'yarn') return ` --cwd ${appDir}`;
  if (pm === 'bun') return ` --cwd ${appDir}`;
  return '';
}

// Detected verification commands: install + static checks + build. No test
// commands — this harness verifies behaviour through the Reviewer, not tests.
export function verificationCommands(project, explicitPackageManager) {
  const pm = explicitPackageManager || project.packageManager || 'npm';
  const appDir = project.appDir || '.';
  const flag = pmDirFlag(pm, appDir);
  const scripts = project.packageJson?.scripts ?? {};
  const run = (script) => {
    if (pm === 'npm') return `npm${flag} run ${script}`;
    if (pm === 'yarn') return `yarn${flag} ${script}`;
    return `${pm}${flag} run ${script}`;
  };

  if (project.stack === 'python') return ['python -m compileall -q .'];
  if (project.stack === 'go') return ['go vet ./...', 'go build ./...'];
  if (project.stack === 'rust') return ['cargo check', 'cargo build --release'];
  if (project.stack === 'java-maven') return ['mvn -q compile', 'mvn -q package -DskipTests'];
  if (project.stack === 'java-gradle') return ['./gradlew classes', './gradlew assemble'];
  if (project.stack === 'dotnet') return ['dotnet restore', 'dotnet build --no-restore'];

  if (!project.packageJson) {
    return [
      'echo "No package manifest detected; replace this line with your project static check command."'
    ];
  }

  const install = pm === 'npm'
    ? `npm${flag} install`
    : pm === 'yarn'
      ? `yarn${flag} install`
      : `${pm}${flag} install`;
  const candidates = [
    scripts.check ? run('check') : null,
    scripts.typecheck ? run('typecheck') : null,
    scripts['type-check'] ? run('type-check') : null,
    scripts.lint ? run('lint') : null,
    scripts.build ? run('build') : null
  ].filter(Boolean);

  return [install, ...dedupe(candidates)];
}

const BUILD_COMMAND_PATTERN = /\b(build|assemble|package)\b/i;

// Splits verification commands into the fast (per-task) tier and the push tier
// (run via `node init.mjs --build`). Fast tier = install + static checks; build
// commands defer to the push gate so the per-task loop stays fast.
export function splitBuildCommands(commands) {
  const fast = [];
  const build = [];
  for (const command of commands) {
    (BUILD_COMMAND_PATTERN.test(command) ? build : fast).push(command);
  }
  return { fast, build };
}

export function initMjsFromCommands(fast, build = []) {
  const fastList = JSON.stringify(fast, null, 2);
  const buildList = JSON.stringify(build, null, 2);
  return `#!/usr/bin/env node
// Cross-platform harness verification runner (source of truth).
// Runs each command in order and exits on the first failure.
// No '&&' chaining, so it behaves the same in bash, cmd, and PowerShell.
//
// Tiered gates:
//   node init.mjs           fast gate (install + static: lint / typecheck) — run per task and at startup
//   node init.mjs --build   quality gate (fast gate + build) — run before pushing
// This harness runs no tests: behaviour is verified by the Reviewer subagent.
// Edit the lists below to match the static checks and build CI runs.
import { spawnSync } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = dirname(fileURLToPath(import.meta.url));
process.chdir(repoRoot);

const fast = ${fastList};

const build = ${buildList};

const withBuild = process.argv.includes('--build') || process.argv.includes('--quality-gate');

function run(command) {
  console.log(\`\\n=== \${command} ===\`);
  const result = spawnSync(command, { shell: true, stdio: 'inherit' });
  if (result.error) {
    console.error(\`\\nFailed to start: \${command}\\n\${result.error.message}\`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(\`\\nCommand failed (exit \${result.status ?? 'signal'}): \${command}\`);
    process.exit(result.status || 1);
  }
}

console.log(withBuild
  ? '=== Harness Quality Gate (fast gate + build) ==='
  : '=== Harness Initialization (fast gate: static only; add --build before pushing) ===');

for (const command of withBuild ? [...fast, ...build] : fast) {
  run(command);
}

if (withBuild) {
  console.log('\\n=== Quality Gate Complete ===');
  process.exit(0);
}

console.log('\\n=== Verification Complete ===');
console.log('');
console.log('Next steps:');
console.log('1. Read feature_list.json to see current task state');
console.log('2. Pick ONE unfinished task to work on');
console.log('3. Implement only that task');
console.log('4. Re-run node init.mjs before marking a task verified');
console.log('5. Before pushing, run: node init.mjs --build');
`;
}

// Renders the AGENTS.md "Verification Commands" list: fast-gate commands, then
// the extra commands the push-time quality gate adds.
export function renderVerificationList(fast, build = []) {
  const lines = fast.map((command) => `- \`${command}\``);
  if (build.length > 0) {
    lines.push('', 'Added by `node init.mjs --build` (quality gate, before pushing):', '');
    lines.push(...build.map((command) => `- \`${command}\``));
  }
  return lines.join('\n');
}

export function initShWrapper() {
  return `#!/bin/bash
set -e
# Bash convenience wrapper. The cross-platform runner is: node init.mjs
exec node "$(dirname "$0")/init.mjs" "$@"
`;
}

export function dedupe(values) {
  return [...new Set(values)];
}

// The only verdicts a committed feature may carry: the Reviewer is the sole behaviour
// check, so `gaps` must be fixed or explicitly accepted (unverified-accepted), and a
// `fail` is never committed over.
const REVIEW_VERDICTS = new Set(['pass', 'unverified-accepted']);
const DONE_STATUSES = new Set(['done']);
// Per-repo delivery-gate policy (top-level approvalMode). Absent ⇒ supervised.
const APPROVAL_MODES = new Set(['autopilot', 'supervised']);
// A task sits here after its fast gate passes, before the feature review and commit.
const EMPTY_EVIDENCE_STATUSES = new Set(['in-progress', 'verified']);
// Rows past not-started must point at a plan file that exists.
const PLAN_REQUIRED_STATUSES = new Set(['in-progress', 'verified', 'done']);
const COMMIT_EVIDENCE_PATTERN = /^commit\s+[0-9a-f]{7,40}\s*$/i;
// Local task id: task-NNN.
const LOCAL_TASK_ID_PATTERN = /^task-\d+$/;
// Feature id grouping tasks: feat-NNN.
const FEAT_ID_PATTERN = /^feat-\d+$/;

export function extractCommitHash(evidence) {
  const match = String(evidence || '').match(/commit\s+([0-9a-f]{7,40})/i);
  return match?.[1] ?? null;
}

export function verifyGitCommit(repoRoot, hash) {
  if (!repoRoot || !hash) return false;
  if (!existsSync(path.join(repoRoot, '.git'))) return false;
  const result = spawnSync('git', ['rev-parse', '--verify', `${hash}^{commit}`], {
    cwd: repoRoot,
    encoding: 'utf8'
  });
  return result.status === 0;
}

export function featureLabel(feature) {
  return feature.name || feature.title || feature.id;
}

export function parseFeatureList(text) {
  if (!text || !text.trim()) {
    return { parsed: null, parseError: 'Feature list is empty' };
  }
  try {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed.tasks)) {
      return { parsed: null, parseError: 'Feature list must contain a tasks array' };
    }
    return { parsed, parseError: null };
  } catch (error) {
    return { parsed: null, parseError: error.message };
  }
}

export function validateFeatureList(parsed, options = {}) {
  const { repoRoot } = options;
  const errors = [];
  const warnings = [];
  if (!parsed || !Array.isArray(parsed.tasks)) {
    return { ok: false, errors: ['Feature list must contain a tasks array'], warnings };
  }

  // approvalMode is optional (defaults to supervised when absent); when present it must be a known enum value.
  if (parsed.approvalMode !== undefined && !APPROVAL_MODES.has(parsed.approvalMode)) {
    warnings.push(`approvalMode "${parsed.approvalMode}" is not a known value (expected ${[...APPROVAL_MODES].join(' or ')}); treating as supervised`);
  }

  // integrationBranch: feature PR target. Soft-warn when missing (upgrade path).
  if (parsed.integrationBranch === undefined || parsed.integrationBranch === null || !String(parsed.integrationBranch).trim()) {
    warnings.push('integrationBranch missing — set the branch feature PRs target (usually the remote default branch, e.g. main)');
  } else {
    const branchName = normalizeBranchName(String(parsed.integrationBranch));
    if (branchName !== String(parsed.integrationBranch).trim()) {
      warnings.push(`integrationBranch should be a bare name (got "${parsed.integrationBranch}"; prefer "${branchName}")`);
    }
  }

  if (parsed.branchPattern !== undefined && (typeof parsed.branchPattern !== 'string' || !parsed.branchPattern.trim())) {
    warnings.push(`branchPattern should be a non-empty string (e.g. "${DEFAULT_BRANCH_PATTERN}")`);
  }

  if (parsed.prHost !== undefined && !PR_HOSTS.includes(parsed.prHost)) {
    warnings.push(`prHost "${parsed.prHost}" is not a known value (expected ${PR_HOSTS.join(', ')}); the agent will detect the host from the origin remote`);
  }

  const ids = new Set();
  const seen = new Set();
  for (const task of parsed.tasks) {
    if (task.id) {
      if (seen.has(task.id)) {
        errors.push(`${task.id}: duplicate task id`);
      }
      seen.add(task.id);
      ids.add(task.id);
    }
  }

  const graph = new Map();
  const doneHashes = new Map();
  const featGroups = new Map();

  for (const task of parsed.tasks) {
    if (!task.id || typeof task.id !== 'string') {
      errors.push('Task missing id');
      continue;
    }

    if (!LOCAL_TASK_ID_PATTERN.test(task.id)) {
      warnings.push(`${task.id}: id should match "task-<number>" (e.g. task-001)`);
    }

    if (!task.name && !task.title) {
      errors.push(`${task.id}: missing name or title`);
    }
    if (!task.description || !String(task.description).trim()) {
      errors.push(`${task.id}: missing description`);
    }
    if (task.verification !== undefined || task.requiredTests !== undefined) {
      warnings.push(`${task.id}: verification/requiredTests are unused — this harness runs no tests; behaviour is verified by the feature review`);
    }

    const featIdText = task.featId != null ? String(task.featId).trim() : '';
    if (!featIdText) {
      errors.push(`${task.id}: missing featId (every task must belong to a feature)`);
    } else if (!FEAT_ID_PATTERN.test(featIdText)) {
      errors.push(`${task.id}: featId "${featIdText}" must match "feat-<number>"`);
    } else {
      if (!featGroups.has(featIdText)) featGroups.set(featIdText, []);
      featGroups.get(featIdText).push(task);
    }

    const evidenceText = task.evidence != null ? String(task.evidence).trim() : '';

    if (EMPTY_EVIDENCE_STATUSES.has(task.status) && evidenceText) {
      errors.push(`${task.id}: ${task.status} tasks must not have evidence (evidence stays empty until the feature commits; all tasks sharing a featId commit together)`);
    }

    if (DONE_STATUSES.has(task.status)) {
      if (!evidenceText) {
        errors.push(`${task.id}: done status requires non-empty evidence`);
      } else if (!COMMIT_EVIDENCE_PATTERN.test(evidenceText)) {
        errors.push(`${task.id}: done evidence must be exactly "commit <hash>" (nothing after the hash)`);
      } else if (repoRoot) {
        const hash = extractCommitHash(evidenceText);
        if (hash && existsSync(path.join(repoRoot, '.git')) && !verifyGitCommit(repoRoot, hash)) {
          errors.push(`${task.id}: evidence commit "${hash}" is not a valid commit in this repository`);
        }
      }
      const doneHash = extractCommitHash(evidenceText);
      if (doneHash) {
        const key = doneHash.toLowerCase();
        if (!doneHashes.has(key)) doneHashes.set(key, []);
        doneHashes.get(key).push(task.id);
      }
    }

    const deps = Array.isArray(task.dependencies) ? task.dependencies : [];
    graph.set(task.id, deps);
    for (const dep of deps) {
      if (!ids.has(dep)) {
        errors.push(`${task.id}: dangling dependency "${dep}"`);
      }
    }
  }

  const cycleNodes = findCycleNodes(graph);
  for (const id of cycleNodes) {
    errors.push(`${id}: dependency cycle detected`);
  }

  // Check A: a hash shared by several `done` rows is only legitimate when every one of
  // those rows carries the same non-empty featId (a real feature commit). Unrelated tasks
  // or two different features colliding on one hash are still errors.
  for (const [hash, taskIds] of doneHashes) {
    if (taskIds.length > 1) {
      const featIdsForHash = taskIds.map((id) => {
        const task = parsed.tasks.find((candidate) => candidate.id === id);
        return task?.featId != null ? String(task.featId).trim() : '';
      });
      const [first] = featIdsForHash;
      const sameNonEmptyFeat = first !== '' && featIdsForHash.every((fid) => fid === first);
      if (!sameNonEmptyFeat) {
        errors.push(`Tasks ${taskIds.join(', ')} share evidence commit "${hash}" but are not from the same feature — only all tasks of a single featId may share a commit`);
      }
    }
  }

  // Check B: feature completeness, checked independently of hash cardinality. Check A only
  // fires when a hash maps to 2+ taskIds, so it never sees a 1-of-N half-commit (only one
  // task of the feature done so far) — that hole is closed here by walking each featId directly.
  for (const [featId, members] of featGroups) {
    // featureBaseSha marks where the feature began, so the step-4 review can scope
    // in-feature commits. Like evidence, it is written to every row in the group —
    // so a disagreement between rows means one of them is wrong about its own feature.
    const baseShas = new Set(members
      .map((task) => (task.featureBaseSha != null ? String(task.featureBaseSha).trim().toLowerCase() : ''))
      .filter(Boolean));
    if (baseShas.size > 1) {
      errors.push(`Feature ${featId} rows carry different featureBaseSha values — the feature has one starting point, recorded identically on every row`);
    }
    for (const sha of baseShas) {
      if (!/^[0-9a-f]{7,40}$/.test(sha)) {
        errors.push(`Feature ${featId}: featureBaseSha "${sha}" is not a git hash (7–40 hex chars)`);
      }
    }
    // The step-4 review writes no report file, so reviewVerdict on the rows is the
    // only trace it ran. Without it a skipped review looks exactly like a clean one.
    const verdicts = new Set(members
      .map((task) => (task.reviewVerdict != null ? String(task.reviewVerdict).trim().toLowerCase() : ''))
      .filter(Boolean));
    if (verdicts.size > 1) {
      errors.push(`Feature ${featId} rows carry different reviewVerdict values — one review covers the whole feature`);
    }
    for (const verdict of verdicts) {
      if (!REVIEW_VERDICTS.has(verdict)) {
        errors.push(`Feature ${featId}: reviewVerdict "${verdict}" is not one of ${[...REVIEW_VERDICTS].join(', ')}`);
      }
    }
    const doneMembers = members.filter((task) => DONE_STATUSES.has(task.status));
    if (doneMembers.length === 0) continue;
    if (verdicts.size === 0) {
      // Tier-1: the review is the harness's only behaviour check, so a committed
      // feature with no verdict means behaviour was never verified.
      errors.push(`Feature ${featId} is done with no reviewVerdict — step 4 (feature review) is the only behaviour check; record pass or unverified-accepted on its rows`);
    }
    const doneIds = doneMembers.map((task) => task.id);
    const hashes = new Set(doneMembers.map((task) => {
      const evidenceText = task.evidence != null ? String(task.evidence).trim() : '';
      return (extractCommitHash(evidenceText) || '').toLowerCase();
    }));
    if (hashes.size > 1) {
      errors.push(`Feature ${featId} tasks (${doneIds.join(', ')}) are done under different commit hashes — a feature commits once, together`);
    } else if (doneMembers.length !== members.length) {
      const pendingIds = members.filter((task) => !DONE_STATUSES.has(task.status)).map((task) => task.id);
      errors.push(`Feature ${featId} is half-committed — ${doneIds.join(', ')} done but ${pendingIds.join(', ')} not — a feature commit must land for every task at once`);
    }
  }

  const inProgress = parsed.tasks.filter((task) => task.status === 'in-progress');
  if (inProgress.length > 1) {
    warnings.push(`Multiple in-progress tasks (${inProgress.length}); WIP=1 recommended`);
  }

  if (repoRoot) {
    for (const task of parsed.tasks) {
      const planFile = task.planFile != null ? String(task.planFile).trim() : '';
      if (!planFile) continue;
      if (!/^\.harness\/plans\/feat-\d+\.md$/.test(planFile)) {
        errors.push(`${task.id}: planFile "${planFile}" must match .harness/plans/feat-NNN.md`);
        continue;
      }
      const planPath = path.join(repoRoot, planFile);
      if (!existsSync(planPath)) {
        if (PLAN_REQUIRED_STATUSES.has(task.status)) {
          errors.push(`${task.id}: planFile "${planFile}" does not exist`);
        }
      } else {
        try {
          const planContent = readFileSync(planPath, 'utf8').replace(/\r\n/g, '\n');
          const frontmatterMatch = planContent.match(/^---\n([\s\S]*?)\n---/);
          if (!frontmatterMatch) {
            warnings.push(`${task.id}: plan file "${planFile}" is missing YAML frontmatter`);
          } else {
            const featIdFromRow = task.featId != null ? String(task.featId).trim() : '';
            const fmFeat = frontmatterMatch[1].match(/^(?:featId|featureId):\s*"?([^"\s]+)"?\s*$/m);
            if (featIdFromRow && (!fmFeat || fmFeat[1] !== featIdFromRow)) {
              errors.push(`${task.id}: plan file "${planFile}" frontmatter featId does not match task's featId (${featIdFromRow})`);
            }
          }
          if (!/^## Task specs\b/m.test(planContent)) {
            warnings.push(`${task.id}: plan file "${planFile}" has no "## Task specs" section — the task contract a fresh session implements from`);
          }
        } catch {
          warnings.push(`${task.id}: plan file "${planFile}" could not be read`);
        }
      }
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

function findCycleNodes(graph) {
  const visited = new Set();
  const stack = new Set();
  const cyclic = new Set();

  function visit(node) {
    if (stack.has(node)) {
      cyclic.add(node);
      return true;
    }
    if (visited.has(node)) return false;
    visited.add(node);
    stack.add(node);
    for (const dep of graph.get(node) || []) {
      if (visit(dep)) cyclic.add(node);
    }
    stack.delete(node);
    return cyclic.has(node);
  }

  for (const node of graph.keys()) visit(node);
  return cyclic;
}

export function scoreHarness(files, options = {}) {
  const byPath = new Map(files.map((file) => [file.path, file.content]));
  const agents = byPath.get('AGENTS.md') || byPath.get('CLAUDE.md') || '';
  const featureList = byPath.get('feature_list.json') || byPath.get('feature-list.json') || '';
  const progress = byPath.get('progress.md') || '';
  const init = byPath.get('init.sh') || '';
  const initMjs = byPath.get('init.mjs') || '';
  const runner = `${init}\n${initMjs}`;
  const handoff = byPath.get('session-handoff.md') || '';

  const { parsed, parseError } = parseFeatureList(featureList);
  const integrity = parsed
    ? validateFeatureList(parsed, { repoRoot: options.repoRoot })
    : { ok: false, errors: [parseError || 'Feature list missing or invalid'], warnings: [] };

  const tier1Errors = parseError
    ? [`Feature list JSON invalid: ${parseError}`]
    : integrity.errors;

  const checks = {
    instructions: [
      hasFile(byPath, ['AGENTS.md', 'CLAUDE.md'], 'Agent instruction file exists'),
      textHas(agents, ['Startup Workflow', 'Before writing code'], 'Startup workflow documented'),
      textHas(agents, ['Definition of Done', 'done only when'], 'Definition of done documented'),
      textHas(agents, ['Verification Commands', './init.sh', 'init.mjs'], 'Verification commands discoverable'),
      textHas(agents, ['feature_list.json', 'progress.md'], 'State artifacts routed from instructions'),
      textHas(agents, ['Task row before code', 'Feature row before code'], 'Mandatory task row before code documented'),
      textHas(agents, ['Branch Discipline', 'Feature branch before code'], 'Feature-branch discipline documented'),
      textHas(agents, ['integrationBranch', 'PR target'], 'PR target branch documented'),
      textHas(agents, ['Request Triage'], 'Request triage documented'),
      textHas(agents, ['Clarification policy', 'elicitationForm'], 'Clarification policy documented'),
      textHas(agents, ['Adjacent surface', 'inherited spec'], 'Adjacent surface gate documented'),
      textHas(agents, ['Planning Phase', 'planning subagent', '.harness/plans/'], 'Planning subagent phase documented'),
      textHas(agents, ['Task spec content bar', 'Task specs'], 'Task spec quality bar documented'),
      textHas(agents, ['Self-audit gate', 'Cross-task dedup'], 'Task spec self-audit documented'),
      textHas(agents, ['before any code', 'before ANY implementation', 'before any implementation'], 'All-before-code triage gate documented'),
      textHas(agents, ['unconfirmed assumption'], 'Unconfirmed assumptions approval documented'),
      textHas(agents, ['Break work down', 'one independently verifiable deliverable'], 'Work breakdown documented'),
      textHas(agents, ['Coverage check'], 'Breakdown coverage check documented'),
      textHas(agents, ['fast gate'], 'Fast gate documented'),
      textHas(agents, ['Unobserved behaviour'], 'Unobserved behaviour gate documented'),
      textHas(agents, ['How to observe'], 'Task specs carry observable checks'),
      textHas(agents, ['Approval mode', 'approvalMode'], 'Approval mode documented'),
      textHas(agents, ['Hard rails'], 'Hard rails documented'),
      textHas(agents, ['Commit approval gate', 'Approve this commit'], 'Commit approval gate documented'),
      textHas(agents, ['Affirmative only', 'only an explicit', 'not** approval'], 'Approval semantics documented'),
      textHas(agents, ['Commit approval ≠ push consent'], 'Commit approval distinct from push consent documented'),
      textHas(agents, ['Commit message format', 'Conventional Commits'], 'Commit message convention documented'),
      textHas(agents, ['Feature delivery', 'one commit per feature'], 'Feature delivery documented'),
      textHas(agents, ['Completing a feature', 'git rev-parse --short HEAD'], 'Ordered done ritual documented'),
      textHas(agents, ['Completion Is Mandatory', 'do not yield until'], 'Completion stop-gate documented'),
      textHas(agents, ['Post-done message', 'Push now?'], 'Post-done message and push offer documented'),
      textHas(agents, ['Pushing (quality gate)', 'push gate'], 'Push gate documented'),
      textHas(agents, ['Non-zero → abort', 'abort the push gate'], 'Quality-gate failure aborts push documented'),
      textHas(agents, ['The queue runs off `committed`'], 'Batched push state model documented'),
      textHas(agents, ['Pull request', 'Open a pull request?'], 'Pull request step documented'),
      textHas(agents, ['Host detection', 'prHost'], 'PR host detection documented'),
      textHas(agents, ['Reviewer'], 'Independent reviewer documented'),
      textHas(agents, ['can **refute** a behavioural criterion', 'can *refute* a behavioural criterion'], 'Reviewer evidence rule documented'),
      textHas(agents, ['failureScenario'], 'Reviewer finding rubric documented'),
      textHas(agents, ['reviewVerdict'], 'Feature review verdict marker documented'),
      textHas(agents, ['featureBaseSha'], 'featureBaseSha recorded at feature start'),
      textHas(agents, ['Closing report', 'evidence: commit'], 'Closing report status line documented'),
      textHas(agents, ['Invalid', 'commit'], 'Invalid verbose evidence examples documented')
    ],
    state: [
      hasFile(byPath, ['feature_list.json', 'feature-list.json'], 'Feature tracker exists'),
      check(options.repoRoot ? existsSync(path.join(options.repoRoot, '.harness', 'plans')) : false, 'Plans directory exists'),
      check(integrity.ok, integrity.ok
        ? 'Feature tracker structural validation passed'
        : `Feature tracker structural validation failed (${integrity.errors.length} issue(s))`),
      check(!parseError && parsed?.tasks
        ?.filter((task) => DONE_STATUSES.has(task.status))
        .every((task) => task.reviewVerdict && String(task.reviewVerdict).trim()), 'All done tasks carry a review verdict'),
      check(!parseError && parsed?.tasks
        ?.filter((task) => DONE_STATUSES.has(task.status))
        .every((task) => task.evidence && String(task.evidence).trim()), 'All done tasks include evidence'),
      hasFile(byPath, ['progress.md'], 'Progress log exists'),
      textHas(progress, ['Current State', 'What', 'Next'], 'Progress log supports restart')
    ],
    verification: [
      hasFile(byPath, ['init.mjs', 'init.sh'], 'Verification entrypoint exists (init.mjs/init.sh)'),
      textHas(runner, ['set -e', 'process.exit'], 'Verification runner fails fast on errors'),
      textHas(agents, ['Reviewer', 'observed'], 'Behaviour verified by an independent reviewer'),
      textHas(runner + agents, ['build', 'type', 'lint', 'compile'], 'Static/build check documented'),
      textHas(agents, ['Evidence format', 'commit'], 'Evidence format documented in instructions')
    ],
    scope: [
      textHas(agents, ['One task at a time', 'one-feature-at-a-time', 'in-progress'], 'One-task-at-a-time rule exists'),
      textHas(featureList, ['dependencies'], 'Task dependencies are tracked'),
      textHas(agents + featureList, ['status'], 'Task status is explicit'),
      textHas(agents, ['Stay in scope', 'scope'], 'Scope boundary documented'),
      textHas(agents, ['Definition of Done'], 'Completion gate limits scope closure')
    ],
    lifecycle: [
      hasFile(byPath, ['init.mjs', 'init.sh'], 'Startup script exists'),
      textHas(agents, ['End of Session', 'Before ending', 'session is not complete'], 'End-of-session procedure exists'),
      hasFile(byPath, ['session-handoff.md'], 'Session handoff template exists'),
      textHas(progress + handoff, ['Last Updated', 'Current Objective', 'Recommended Next Step'], 'Session restart markers exist'),
      textHas(agents + handoff + progress, ['Blockers', 'Next Session', 'Next Step'], 'Handoff captures blockers and next step')
    ]
  };

  const subsystems = Object.fromEntries(Object.entries(checks).map(([name, subsystemChecks]) => {
    const passed = subsystemChecks.filter((item) => item.pass).length;
    const score = Math.max(1, Math.round((passed / subsystemChecks.length) * 5));
    return [name, {
      score,
      passed,
      total: subsystemChecks.length,
      checks: subsystemChecks
    }];
  }));

  const total = Object.values(subsystems).reduce((sum, item) => sum + item.score, 0);
  const overall = Math.round((total / (SUBSYSTEMS.length * 5)) * 100);
  const bottleneck = Object.entries(subsystems).sort((a, b) => a[1].score - b[1].score)[0][0];

  return {
    overall,
    bottleneck,
    subsystems,
    tier1Failed: tier1Errors.length > 0,
    tier1Errors,
    warnings: [...integrity.warnings]
  };
}

function check(pass, message) {
  return { pass, message };
}

function hasFile(byPath, names, message) {
  return { pass: names.some((name) => byPath.has(name)), message };
}

function textHas(text, needles, message) {
  const lower = text.toLowerCase();
  return { pass: needles.some((needle) => lower.includes(needle.toLowerCase())), message };
}

export async function loadHarnessFiles(root) {
  const candidates = [
    'AGENTS.md',
    'CLAUDE.md',
    'feature_list.json',
    'feature-list.json',
    'progress.md',
    'session-handoff.md',
    'init.sh',
    'init.mjs'
  ];
  const files = [];
  for (const candidate of candidates) {
    const fullPath = path.join(root, candidate);
    if (await exists(fullPath)) {
      files.push({ path: candidate, content: await readText(fullPath) });
    }
  }
  return files;
}

export function formatScoreReport(result, root = '.') {
  const lines = [
    `Harness validation for ${root}`,
    `Overall: ${result.overall}/100`,
    `Bottleneck: ${result.bottleneck}`,
    ''
  ];

  if (result.tier1Failed && result.tier1Errors?.length) {
    lines.push('TIER 1 FAILURES (structural):');
    for (const error of result.tier1Errors) {
      lines.push(`  FAIL ${error}`);
    }
    lines.push('');
  }

  if (result.warnings?.length) {
    lines.push('WARNINGS:');
    for (const warning of result.warnings) {
      lines.push(`  WARN ${warning}`);
    }
    lines.push('');
  }

  for (const [name, subsystem] of Object.entries(result.subsystems)) {
    lines.push(`${name}: ${subsystem.score}/5 (${subsystem.passed}/${subsystem.total})`);
    for (const check of subsystem.checks) {
      lines.push(`  ${check.pass ? 'PASS' : 'FAIL'} ${check.message}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

export function htmlReport(result, title = 'Harness Assessment') {
  const tier1 = result.tier1Errors?.length
    ? `<section><h2>Tier 1 failures</h2><ul>${result.tier1Errors.map((error) =>
      `<li class="fail">${escapeHtml(error)}</li>`).join('')}</ul></section>`
    : '';
  const warnings = result.warnings?.length
    ? `<section><h2>Warnings</h2><ul>${result.warnings.map((warning) =>
      `<li>${escapeHtml(warning)}</li>`).join('')}</ul></section>`
    : '';

  const rows = Object.entries(result.subsystems).map(([name, subsystem]) => {
    const checks = subsystem.checks.map((check) =>
      `<li class="${check.pass ? 'pass' : 'fail'}">${check.pass ? 'PASS' : 'FAIL'} ${escapeHtml(check.message)}</li>`
    ).join('');
    return `<section>
      <h2>${escapeHtml(name)} <span>${subsystem.score}/5</span></h2>
      <ul>${checks}</ul>
    </section>`;
  }).join('\n');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 32px; color: #172026; background: #f7f8fa; }
    main { max-width: 960px; margin: 0 auto; }
    header { margin-bottom: 24px; }
    h1 { margin: 0 0 8px; font-size: 32px; }
    .summary { display: flex; gap: 16px; flex-wrap: wrap; margin: 20px 0; }
    .metric { background: white; border: 1px solid #d9dee5; border-radius: 8px; padding: 16px 18px; min-width: 180px; }
    .metric strong { display: block; font-size: 28px; margin-top: 4px; }
    section { background: white; border: 1px solid #d9dee5; border-radius: 8px; margin: 14px 0; padding: 16px 18px; }
    h2 { margin: 0 0 10px; font-size: 20px; display: flex; justify-content: space-between; }
    ul { margin: 0; padding-left: 20px; }
    li { margin: 6px 0; }
    .pass { color: #126c43; }
    .fail { color: #a23020; }
  </style>
</head>
<body>
  <main>
    <header>
      <h1>${escapeHtml(title)}</h1>
      <p>Five-subsystem harness validation report.</p>
      <div class="summary">
        <div class="metric">Overall<strong>${result.overall}/100</strong></div>
        <div class="metric">Bottleneck<strong>${escapeHtml(result.bottleneck)}</strong></div>
      </div>
    </header>
    ${tier1}
    ${warnings}
    ${rows}
  </main>
</body>
</html>
`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export async function copyFileSafe(source, target, { force = false } = {}) {
  if (!force && await exists(target)) {
    return { path: target, status: 'skipped', reason: 'exists' };
  }
  await mkdir(path.dirname(target), { recursive: true });
  await copyFile(source, target);
  return { path: target, status: 'written' };
}

// --- Harness upgrade -------------------------------------------------------
// Per-repo upgrade refreshes the skill-owned instruction block while preserving
// user content outside it.
//
// Marker contract (inverted from the early "user pocket" sketch):
//   <!-- harness:managed:start --> … <!-- harness:managed:end -->
// wraps the skill-owned harness instructions and is REPLACED on upgrade.
// Everything outside the markers (including PROJECT_PURPOSE) is PRESERVED.

export const HARNESS_MANAGED_START = '<!-- harness:managed:start -->';
export const HARNESS_MANAGED_END = '<!-- harness:managed:end -->';

// Legacy 2.5.0 user-pocket markers — migrated into the user zone on first
// managed-region upgrade, then discarded.
const HARNESS_LOCAL_START = '<!-- harness:local:start -->';
const HARNESS_LOCAL_END = '<!-- harness:local:end -->';

export async function readSkillMetadata() {
  return readJson(path.join(SKILL_ROOT, 'metadata.json'));
}

export async function resolveAgentFile(root) {
  if (await exists(path.join(root, 'AGENTS.md'))) return 'AGENTS.md';
  if (await exists(path.join(root, 'CLAUDE.md'))) return 'CLAUDE.md';
  return null;
}

// First non-empty paragraph after the "# <name>" title heading. Stops at the
// next heading or a harness marker comment.
export function extractProjectPurpose(content) {
  const lines = String(content).split('\n');
  let i = 0;
  while (i < lines.length && !/^#\s+/.test(lines[i])) i += 1;
  if (i < lines.length) i += 1;
  while (i < lines.length && lines[i].trim() === '') i += 1;
  const paragraph = [];
  while (i < lines.length && lines[i].trim() !== '') {
    const line = lines[i];
    if (/^#{1,6}\s/.test(line)) break;
    if (line.trim().startsWith('<!--')) break;
    paragraph.push(line);
    i += 1;
  }
  return paragraph.join('\n').trim();
}

export function hasHarnessManagedRegion(content) {
  const text = String(content);
  const startIdx = text.indexOf(HARNESS_MANAGED_START);
  const endIdx = text.indexOf(HARNESS_MANAGED_END);
  return startIdx !== -1 && endIdx !== -1 && endIdx > startIdx;
}

export function extractHarnessManagedRegion(content) {
  const text = String(content);
  const startIdx = text.indexOf(HARNESS_MANAGED_START);
  const endIdx = text.indexOf(HARNESS_MANAGED_END);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) return '';
  return text.slice(startIdx + HARNESS_MANAGED_START.length, endIdx).trim();
}

export function injectHarnessManagedRegion(content, managedBody) {
  const text = String(content);
  const startIdx = text.indexOf(HARNESS_MANAGED_START);
  const endIdx = text.indexOf(HARNESS_MANAGED_END);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) return text;
  const body = String(managedBody || '').trim();
  const before = text.slice(0, startIdx + HARNESS_MANAGED_START.length);
  const after = text.slice(endIdx);
  return `${before}${body ? `\n${body}\n` : '\n'}${after}`;
}

function extractLegacyLocalRegion(content) {
  const text = String(content);
  const startIdx = text.indexOf(HARNESS_LOCAL_START);
  const endIdx = text.indexOf(HARNESS_LOCAL_END);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) return '';
  return text.slice(startIdx + HARNESS_LOCAL_START.length, endIdx).trim();
}

export async function buildAgentsReplacements(target, { agentFile = 'AGENTS.md', projectPurpose } = {}) {
  const project = await detectProject(target);
  project.packageManager = detectPackageManager(target, undefined, project.appDir);
  const commands = verificationCommands(project);
  const { fast, build } = splitBuildCommands(commands);
  const purpose = projectPurpose && projectPurpose.trim()
    ? projectPurpose.trim()
    : (project.stack === 'generic'
      ? 'Project harness for reliable agent-assisted development.'
      : `Project harness for reliable agent-assisted development in a ${project.stack} codebase.`);
  return {
    AGENT_FILE_NAME: agentFile,
    PROJECT_PURPOSE: purpose,
    VERIFICATION_COMMANDS: renderVerificationList(fast, build),
    PRIMARY_VERIFICATION_COMMAND: 'node init.mjs'
  };
}

export async function renderAgentsFromTemplate(replacements) {
  let contents = await readText(path.join(TEMPLATE_DIR, 'agents.md'));
  contents = contents.replace(/\r\n/g, '\n');
  for (const [key, value] of Object.entries(replacements)) {
    contents = contents.split(`{{${key}}}`).join(value);
  }
  return contents;
}

// Build the post-upgrade agent file:
// - With harness:managed markers: replace only the managed body; keep user content outside.
// - Without markers (first upgrade): write the full template (purpose preserved).
//   Legacy harness:local pocket content is migrated into the user zone above the managed block.
export function composeUpgradedAgentsFile(liveContent, renderedTemplate) {
  const newManagedBody = extractHarnessManagedRegion(renderedTemplate);
  if (hasHarnessManagedRegion(liveContent)) {
    return {
      content: injectHarnessManagedRegion(liveContent, newManagedBody),
      mode: 'managed-splice',
      migratedLocalBytes: 0
    };
  }

  const legacyLocal = extractLegacyLocalRegion(liveContent);
  let content = renderedTemplate;
  if (legacyLocal) {
    content = content.replace(
      HARNESS_MANAGED_START,
      `${legacyLocal}\n\n${HARNESS_MANAGED_START}`
    );
  }
  return {
    content,
    mode: 'full-replace',
    migratedLocalBytes: Buffer.byteLength(legacyLocal, 'utf8')
  };
}

// Warn when content INSIDE the managed region will be replaced (edits to skill text).
// Content outside the markers is preserved and is not a warning.
export function detectManagedRegionEdits(liveContent, newManagedBody) {
  if (!hasHarnessManagedRegion(liveContent)) {
    const legacyLocal = extractLegacyLocalRegion(liveContent);
    return {
      hasManagedMarkers: false,
      hasManagedEdits: false,
      summary: legacyLocal
        ? 'No harness:managed markers yet — upgrade will replace the instruction file from the template (PROJECT_PURPOSE preserved). Legacy harness:local content will be moved above the new managed block.'
        : 'No harness:managed markers yet — upgrade will replace the instruction file from the template (PROJECT_PURPOSE preserved). After this upgrade, put repo-only rules outside the managed markers so they survive future upgrades.'
    };
  }

  const liveManaged = extractHarnessManagedRegion(liveContent);
  const normalize = (text) => String(text).replace(/\s+/g, ' ').trim();
  if (normalize(liveManaged) === normalize(newManagedBody)) {
    return { hasManagedMarkers: true, hasManagedEdits: false, summary: '' };
  }
  return {
    hasManagedMarkers: true,
    hasManagedEdits: true,
    summary: 'Content inside harness:managed markers differs from this skill version and will be replaced. Content outside the markers is preserved.'
  };
}

export async function mergeApprovalModeIfMissing(featureListPath) {
  const parsed = JSON.parse(await readText(featureListPath));
  if (Object.prototype.hasOwnProperty.call(parsed, 'approvalMode')) {
    return { changed: false, previous: parsed.approvalMode };
  }
  const merged = { approvalMode: 'supervised', ...parsed };
  await writeText(featureListPath, `${JSON.stringify(merged, null, 2)}\n`);
  return { changed: true, previous: null };
}

export async function mergeBranchPatternIfMissing(featureListPath) {
  const parsed = JSON.parse(await readText(featureListPath));
  if (typeof parsed.branchPattern === 'string' && parsed.branchPattern.trim()) {
    return { changed: false, previous: parsed.branchPattern };
  }
  const { approvalMode, integrationBranch, ...rest } = parsed;
  const merged = {
    ...(approvalMode !== undefined ? { approvalMode } : {}),
    ...(integrationBranch !== undefined ? { integrationBranch } : {}),
    branchPattern: DEFAULT_BRANCH_PATTERN,
    ...rest
  };
  await writeText(featureListPath, `${JSON.stringify(merged, null, 2)}\n`);
  return { changed: true, previous: null };
}

/**
 * Merge integrationBranch only when missing AND a validated value is supplied.
 * The caller resolves the value (explicit flag, else origin/HEAD).
 * @param {string} featureListPath
 * @param {string} integrationBranch
 */
export async function mergeIntegrationBranchIfMissing(featureListPath, integrationBranch) {
  const parsed = JSON.parse(await readText(featureListPath));
  if (Object.prototype.hasOwnProperty.call(parsed, 'integrationBranch')
    && parsed.integrationBranch != null
    && String(parsed.integrationBranch).trim()) {
    return { changed: false, previous: parsed.integrationBranch };
  }
  const asserted = assertIntegrationBranch(integrationBranch);
  if (!asserted.ok) {
    return { changed: false, previous: null, error: asserted.error };
  }
  const { approvalMode, ...rest } = parsed;
  const merged = {
    ...(approvalMode !== undefined ? { approvalMode } : {}),
    integrationBranch: asserted.name,
    ...rest
  };
  await writeText(featureListPath, `${JSON.stringify(merged, null, 2)}\n`);
  return { changed: true, previous: null, name: asserted.name };
}

export async function writeHarnessManifest(target, { agentFile, version }) {
  const manifestPath = path.join(target, '.harness', 'manifest.json');
  const manifest = {
    workhorseVersion: version,
    upgradedAt: new Date().toISOString(),
    agentFile
  };
  await writeText(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return { path: manifestPath, manifest };
}

export async function buildUpgradePlan(target) {
  const agentFile = await resolveAgentFile(target);
  const featureListPath = path.join(target, 'feature_list.json');
  const legacyFeatureListPath = path.join(target, 'feature-list.json');
  const activeFeatureListPath = await exists(featureListPath)
    ? featureListPath
    : (await exists(legacyFeatureListPath) ? legacyFeatureListPath : null);

  if (!agentFile || !activeFeatureListPath) {
    return { isHarness: false, agentFile, hasFeatureList: Boolean(activeFeatureListPath), readyToApply: false };
  }

  const liveContent = await readText(path.join(target, agentFile));
  const projectPurpose = extractProjectPurpose(liveContent);
  const replacements = await buildAgentsReplacements(target, { agentFile, projectPurpose });
  const renderedTemplate = await renderAgentsFromTemplate(replacements);
  const newManagedBody = extractHarnessManagedRegion(renderedTemplate);
  const composed = composeUpgradedAgentsFile(liveContent, renderedTemplate);
  const managedEdits = detectManagedRegionEdits(liveContent, newManagedBody);

  const files = await loadHarnessFiles(target);
  const validation = scoreHarness(files, { repoRoot: target });

  const metadata = await readSkillMetadata();
  const manifestPath = path.join(target, '.harness', 'manifest.json');
  const currentManifest = await exists(manifestPath) ? await readJson(manifestPath) : null;

  let approvalModeMissing = false;
  let integrationBranchMissing = false;
  let branchPatternMissing = false;
  try {
    const featureList = await readJson(activeFeatureListPath);
    approvalModeMissing = !Object.prototype.hasOwnProperty.call(featureList, 'approvalMode');
    integrationBranchMissing = !Object.prototype.hasOwnProperty.call(featureList, 'integrationBranch')
      || featureList.integrationBranch == null
      || !String(featureList.integrationBranch).trim();
    branchPatternMissing = !(typeof featureList.branchPattern === 'string' && featureList.branchPattern.trim());
  } catch {
    approvalModeMissing = false;
    integrationBranchMissing = false;
    branchPatternMissing = false;
  }

  const willChange = [agentFile, '.harness/manifest.json', '.harness/templates/ (plan templates and UI build guide refreshed)'];
  if (approvalModeMissing) willChange.push('feature_list.json (approvalMode merge)');
  if (branchPatternMissing) willChange.push(`feature_list.json (branchPattern merge — ${DEFAULT_BRANCH_PATTERN})`);
  if (integrationBranchMissing) {
    willChange.push('feature_list.json (integrationBranch — from --integration-branch, else origin/HEAD)');
  }

  return {
    isHarness: true,
    agentFile,
    skillVersion: metadata.version,
    currentManifest,
    projectPurpose: replacements.PROJECT_PURPOSE,
    hasManagedMarkers: managedEdits.hasManagedMarkers,
    upgradeMode: composed.mode,
    migratedLocalBytes: composed.migratedLocalBytes,
    managedRegionBytes: Buffer.byteLength(newManagedBody, 'utf8'),
    validation,
    managedEdits,
    // Back-compat alias used by early plan consumers / tests
    unmarkedEdits: {
      hasUnmarkedEdits: managedEdits.hasManagedEdits || !managedEdits.hasManagedMarkers,
      summary: managedEdits.summary
    },
    approvalModeMissing,
    integrationBranchMissing,
    branchPatternMissing,
    willChange,
    renderedContent: composed.content,
    featureListPath: activeFeatureListPath,
    readyToApply: true
  };
}
