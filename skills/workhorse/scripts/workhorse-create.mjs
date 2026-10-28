#!/usr/bin/env node
import { chmod, mkdir } from 'node:fs/promises';
import path from 'node:path';
import {
  DEFAULT_BRANCH_PATTERN,
  DEFAULT_UI_LIBRARY,
  PR_HOSTS,
  assertIntegrationBranch,
  buildFeatureList,
  copyTemplate,
  detectDefaultBranch,
  detectPackageManager,
  detectPrHost,
  detectUiLibrary,
  detectProject,
  exists,
  initMjsFromCommands,
  initShWrapper,
  parseArgs,
  readOriginUrl,
  renderVerificationList,
  splitBuildCommands,
  verificationCommands,
  writeText
} from './lib/workhorse-utils.mjs';

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  console.log(`Usage: node scripts/workhorse-create.mjs [--target DIR] [--approval-mode autopilot|supervised] [--integration-branch NAME] [--branch-pattern PATTERN] [--pr-host github|gitlab|azure|none] [--ui-library shadcn|none|NAME] [--agent-file AGENTS.md|CLAUDE.md] [--package-manager npm|pnpm|yarn|bun] [--commands "cmd one,cmd two"] [--force]

Creates a minimal production harness:
  AGENTS.md or CLAUDE.md
  feature_list.json
  progress.md
  session-handoff.md
  init.mjs + init.sh
  .harness/plans/ (directory for overview + per-feature plan files)

Options:
  --approval-mode       supervised (default): human approves each commit, push, and PR.
                        autopilot: commit after verification, push at push-gate invocations,
                        open the PR after the first push. Ask the human which they want.
  --integration-branch  Branch feature PRs target. Default: the remote default branch
                        (origin/HEAD), else "main".
  --branch-pattern      Feature branch naming convention. Default: ${DEFAULT_BRANCH_PATTERN}
  --ui-library          Component library for UI work. Default: the library the project already
                        uses (MUI, Chakra, …, or shadcn when components.json exists), else
                        "${DEFAULT_UI_LIBRARY}" — the shadcn family, picked per stack. "none" opts out
                        and has UI built by hand.
  --pr-host             Override PR host detection. Default: derived from the origin remote at
                        runtime (not written unless passed).
  --commands            Comma-separated static-check and build commands, replacing detection.
                        Commands that look like builds run only under "node init.mjs --build".

The harness runs no tests: behaviour is verified by the Reviewer subagent.

Existing files are skipped unless --force is set.`);
  process.exit(0);
}

const APPROVAL_MODES = ['autopilot', 'supervised'];
const approvalMode = typeof args.approvalMode === 'string' && args.approvalMode.trim()
  ? args.approvalMode.trim()
  : 'supervised';

if (!APPROVAL_MODES.includes(approvalMode)) {
  console.error(`Error: --approval-mode must be one of ${APPROVAL_MODES.join(', ')} (got "${approvalMode}").`);
  process.exit(1);
}

const target = path.resolve(args.target || args._[0] || process.cwd());

const integrationBranchArg = typeof args.integrationBranch === 'string' ? args.integrationBranch.trim() : '';
const defaultBranch = integrationBranchArg ? '' : detectDefaultBranch(target);
const integrationBranchSource = integrationBranchArg ? 'flag' : (defaultBranch ? 'origin/HEAD' : 'fallback');
const integrationBranchCheck = assertIntegrationBranch(integrationBranchArg || defaultBranch || 'main');
if (!integrationBranchCheck.ok) {
  console.error(`Error: ${integrationBranchCheck.error}`);
  process.exit(1);
}
const integrationBranch = integrationBranchCheck.name;

const branchPattern = typeof args.branchPattern === 'string' && args.branchPattern.trim()
  ? args.branchPattern.trim()
  : DEFAULT_BRANCH_PATTERN;

const prHost = typeof args.prHost === 'string' && args.prHost.trim() ? args.prHost.trim() : undefined;
if (prHost && !PR_HOSTS.includes(prHost)) {
  console.error(`Error: --pr-host must be one of ${PR_HOSTS.join(', ')} (got "${prHost}").`);
  process.exit(1);
}

const uiLibraryArg = typeof args.uiLibrary === 'string' && args.uiLibrary.trim() ? args.uiLibrary.trim() : '';

const agentFile = args.agentFile || 'AGENTS.md';
const force = Boolean(args.force);
const project = await detectProject(target);
project.packageManager = detectPackageManager(target, args.packageManager, project.appDir);
const commands = args.commands
  ? String(args.commands).split(',').map((command) => command.trim()).filter(Boolean)
  : verificationCommands(project, args.packageManager);

const { fast, build } = splitBuildCommands(commands);

const detectedUi = detectUiLibrary(project);
const uiLibrary = uiLibraryArg || detectedUi.library;
const uiLibrarySource = uiLibraryArg ? 'flag' : detectedUi.source;

await mkdir(target, { recursive: true });

const replacements = {
  AGENT_FILE_NAME: agentFile,
  PROJECT_PURPOSE: project.stack === 'generic'
    ? 'Project harness for reliable agent-assisted development.'
    : `Project harness for reliable agent-assisted development in a ${project.stack} codebase.`,
  VERIFICATION_COMMANDS: renderVerificationList(fast, build),
  PRIMARY_VERIFICATION_COMMAND: 'node init.mjs'
};

const results = [];
results.push(await copyTemplate('agents.md', path.join(target, agentFile), replacements, { force }));

const featureListPath = path.join(target, 'feature_list.json');
if (force || !await exists(featureListPath)) {
  await writeText(featureListPath, await buildFeatureList('feature-list.json', {
    approvalMode,
    integrationBranch,
    branchPattern,
    uiLibrary,
    prHost
  }));
  results.push({ path: featureListPath, status: 'written' });
} else {
  results.push({ path: featureListPath, status: 'skipped', reason: 'exists' });
}

results.push(await copyTemplate('progress.md', path.join(target, 'progress.md'), {}, { force }));
results.push(await copyTemplate('session-handoff.md', path.join(target, 'session-handoff.md'), {}, { force }));

const initMjsPath = path.join(target, 'init.mjs');
if (force || !await exists(initMjsPath)) {
  await writeText(initMjsPath, initMjsFromCommands(fast, build));
  results.push({ path: initMjsPath, status: 'written' });
} else {
  results.push({ path: initMjsPath, status: 'skipped', reason: 'exists' });
}

const initShPath = path.join(target, 'init.sh');
if (force || !await exists(initShPath)) {
  await writeText(initShPath, initShWrapper());
  await chmod(initShPath, 0o755);
  results.push({ path: initShPath, status: 'written' });
} else {
  results.push({ path: initShPath, status: 'skipped', reason: 'exists' });
}

// Plan templates the planning subagent follows. They live in the repo so the
// AGENTS.md pointers resolve without the skill installed.
for (const name of ['overview-plan.md', 'plan.md', 'ui-build.md']) {
  results.push(await copyTemplate(name, path.join(target, '.harness', 'templates', name), {}, { force }));
}

// Scaffold .harness/plans/ with a .gitkeep so the planning subagent has a stable
// target for overview.md (Phase 1) and feat-NNN.md (Phase 2).
const plansDir = path.join(target, '.harness', 'plans');
await mkdir(plansDir, { recursive: true });
const gitkeepPath = path.join(plansDir, '.gitkeep');
if (force || !await exists(gitkeepPath)) {
  await writeText(gitkeepPath, '');
  results.push({ path: gitkeepPath, status: 'written' });
} else {
  results.push({ path: gitkeepPath, status: 'skipped', reason: 'exists' });
}

const detectedHost = prHost || detectPrHost(readOriginUrl(target));

console.log(`Created harness for ${target}`);
console.log(`Detected stack: ${project.stack}`);
console.log(`Approval mode: ${approvalMode}`);
console.log(`Integration branch: ${integrationBranch} (${integrationBranchSource})`);
console.log(`Branch pattern: ${branchPattern}`);
console.log(`UI library: ${uiLibrary} (${uiLibrarySource})`);
console.log(`PR host: ${detectedHost}${prHost ? ' (override)' : ' (detected from origin; re-detected at runtime)'}`);
console.log('Fast gate (node init.mjs):');
for (const command of fast) {
  console.log(`  - ${command}`);
}
console.log('Quality gate adds (node init.mjs --build):');
for (const command of build.length ? build : ['(nothing beyond the fast gate — edit init.mjs to add a build)']) {
  console.log(`  - ${command}`);
}
console.log('');
for (const result of results) {
  console.log(`${result.status.toUpperCase()} ${path.relative(target, result.path)}${result.reason ? ` (${result.reason})` : ''}`);
}
