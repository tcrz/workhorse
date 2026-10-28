#!/usr/bin/env node
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CONVENTIONAL_COMMIT_TYPES,
  assertIntegrationBranch,
  branchPatternToRegExp,
  composeUpgradedAgentsFile,
  detectManagedRegionEdits,
  detectPrHost,
  extractHarnessManagedRegion,
  extractProjectPurpose,
  hasHarnessManagedRegion,
  mergeApprovalModeIfMissing,
  mergeBranchPatternIfMissing,
  mergeIntegrationBranchIfMissing,
  normalizeBranchName,
  readSkillMetadata,
  renderAgentsFromTemplate,
  splitBuildCommands,
  verificationCommands,
  validateCommitMessage,
  validateFeatureList,
  writeHarnessManifest
} from './lib/workhorse-utils.mjs';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const createScript = path.join(skillRoot, 'scripts', 'workhorse-create.mjs');
const validateScript = path.join(skillRoot, 'scripts', 'workhorse-validate.mjs');
const upgradeScript = path.join(skillRoot, 'scripts', 'workhorse-upgrade.mjs');

function runNode(script, args, options = {}) {
  const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', ...options });
  return {
    status: result.status ?? 1,
    stdout: result.stdout || '',
    stderr: result.stderr || ''
  };
}

function git(cwd, args) {
  const result = spawnSync('git', ['-c', 'user.email=self-test@example.com', '-c', 'user.name=self-test', ...args], {
    cwd,
    encoding: 'utf8'
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  }
  return result.stdout.trim();
}

function expectErrors(result, pattern, label) {
  if (result.ok || !result.errors.some((error) => pattern.test(error))) {
    throw new Error(`${label}: expected a tier-1 error matching ${pattern} (got ${JSON.stringify(result.errors)})`);
  }
}

function expectOk(result, label) {
  if (!result.ok) {
    throw new Error(`${label}: expected no tier-1 errors (got ${JSON.stringify(result.errors)})`);
  }
}

const row = (overrides = {}) => ({
  id: 'task-001',
  featId: 'feat-001',
  name: 'Reject blank todo titles with an inline error',
  description: 'Submitting a blank title shows an inline error and saves nothing',
  dependencies: [],
  status: 'not-started',
  evidence: '',
  ...overrides
});

const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'harness-self-test-'));

try {
  // --- Skill content stays organisation-neutral ------------------------------
  const ORG_SPECIFIC = /hubtel|hbtl|sprint planner|sonarqube|aqua quality-gate|karate|get_task_details|harness_create_tasks|requiredTests/i;
  for (const dir of ['templates', 'references']) {
    for (const name of await readdir(path.join(skillRoot, dir))) {
      const content = await readFile(path.join(skillRoot, dir, name), 'utf8');
      const match = content.match(ORG_SPECIFIC);
      if (match) {
        throw new Error(`${dir}/${name} contains organisation-specific text "${match[0]}"`);
      }
    }
  }

  // --- Plugin packaging (when the skill sits inside the plugin repo) -----------
  const pluginRoot = path.resolve(skillRoot, '..', '..');
  const claudeManifestPath = path.join(pluginRoot, '.claude-plugin', 'plugin.json');
  const inPlugin = await readFile(claudeManifestPath, 'utf8').then(() => true, () => false);
  if (inPlugin) {
    const readJson = async (rel) => JSON.parse(await readFile(path.join(pluginRoot, rel), 'utf8'));
    const claudeManifest = await readJson('.claude-plugin/plugin.json');
    const cursorManifest = await readJson('.cursor-plugin/plugin.json');
    const skillMeta = await readJson('skills/workhorse/metadata.json');
    for (const field of ['name', 'version', 'description']) {
      if (claudeManifest[field] !== cursorManifest[field]) {
        throw new Error(`.claude-plugin and .cursor-plugin manifests disagree on "${field}"`);
      }
    }
    if (claudeManifest.version !== skillMeta.version) {
      throw new Error(`plugin version ${claudeManifest.version} does not match skill metadata version ${skillMeta.version}`);
    }
    if (JSON.stringify(await readJson('.mcp.json')) !== JSON.stringify(await readJson('mcp.json'))) {
      throw new Error('.mcp.json (Claude Code) and mcp.json (Cursor) must declare the same servers');
    }
    const mcp = await readJson('.mcp.json');
    if (!/@playwright\/mcp@\d+\.\d+\.\d+$/.test(mcp.mcpServers?.playwright?.args?.[1] || '')) {
      throw new Error('the bundled Playwright MCP must be pinned to an exact version');
    }
    // Vendored skills match their vendor.json pins and carry their upstream license.
    const vendor = await readJson('vendor.json');
    for (const entry of vendor.skills) {
      const dir = path.join(pluginRoot, 'skills', entry.name);
      const license = await readFile(path.join(dir, 'LICENSE'), 'utf8').catch(() => '');
      const vendored = await readFile(path.join(dir, 'VENDORED.md'), 'utf8').catch(() => '');
      const skill = await readFile(path.join(dir, 'SKILL.md'), 'utf8').catch(() => '');
      if (!skill.includes(`name: ${entry.name}`)) throw new Error(`vendored skill ${entry.name} is missing or misnamed — run tools/sync-vendored-skills.mjs`);
      if (!license.includes(entry.copyright)) throw new Error(`vendored skill ${entry.name} must ship its upstream LICENSE ("${entry.copyright}")`);
      if (!vendored.includes(entry.sha)) throw new Error(`vendored skill ${entry.name} doesn't match its vendor.json pin — run tools/sync-vendored-skills.mjs`);
    }
    const notices = await readFile(path.join(pluginRoot, 'THIRD_PARTY_NOTICES.md'), 'utf8');
    for (const entry of vendor.skills) {
      if (!notices.includes(entry.repo)) throw new Error(`THIRD_PARTY_NOTICES.md must credit ${entry.repo}`);
    }

    // Agent files stay thin: identity + tool limits + a few safety lines + a pointer to
    // the AGENTS.md section that is their rulebook. The rules live in one place.
    const template = await readFile(path.join(skillRoot, 'templates', 'agents.md'), 'utf8');
    const rulebooks = {
      'workhorse-reviewer': ['Rail invocation', 'Unobserved behaviour', 'Finding rubric', 'Return shape'],
      'workhorse-planner': ['Clarification policy', 'Planning Phase', 'Task spec content bar', 'Break work down']
    };
    const COPIED_RULES = /criteriaChecked|confirmed\[\]|four hold|≤ ?5|Phase 1 —|How to observe|~40 tool calls|`gaps` —/;
    for (const [agent, sections] of Object.entries(rulebooks)) {
      const body = await readFile(path.join(pluginRoot, 'agents', `${agent}.md`), 'utf8');
      if (!body.includes(`name: ${agent}`) || !/disallowedTools:.*Edit.*Write/.test(body)) {
        throw new Error(`agents/${agent}.md must declare its name and remove Edit/Write`);
      }
      for (const section of sections) {
        if (!body.includes(section)) throw new Error(`agents/${agent}.md must point to the "${section}" section`);
        if (!template.includes(`### ${section}`)) throw new Error(`agents/${agent}.md points to "${section}", which templates/agents.md no longer has`);
      }
      const copied = body.match(COPIED_RULES);
      if (copied) throw new Error(`agents/${agent}.md restates rulebook content ("${copied[0]}") — keep rules in templates/agents.md and point to them`);
      if (body.split('\n').length > 30) throw new Error(`agents/${agent}.md is over 30 lines — it should be a pointer, not a copy`);
    }
  }

  // --- Pure helpers ------------------------------------------------------------
  if (normalizeBranchName('refs/remotes/origin/main') !== 'main' || normalizeBranchName('origin/develop') !== 'develop') {
    throw new Error('normalizeBranchName must strip refs/remotes/ and origin/ prefixes');
  }
  if (!assertIntegrationBranch('main').ok) {
    throw new Error('assertIntegrationBranch must accept main — the general harness allows PRs to the default branch');
  }
  if (assertIntegrationBranch('').ok || assertIntegrationBranch('has space').ok) {
    throw new Error('assertIntegrationBranch must reject empty and whitespace names');
  }

  const defaultPattern = branchPatternToRegExp('feature/<short-desc>');
  if (!defaultPattern.test('feature/add-login') || defaultPattern.test('main') || defaultPattern.test('feature/a/b')) {
    throw new Error('branchPatternToRegExp("feature/<short-desc>") must match one kebab segment under feature/');
  }
  if (!branchPatternToRegExp('users/<username>/feature/<short-desc>').test('users/jane/feature/x')) {
    throw new Error('branchPatternToRegExp must support multiple placeholders');
  }
  if (!branchPatternToRegExp('fix.<short-desc>').test('fix.a') || branchPatternToRegExp('fix.<short-desc>').test('fixXa')) {
    throw new Error('branchPatternToRegExp must escape regex metacharacters in literal segments');
  }

  for (const [url, host] of [
    ['git@github.com:org/repo.git', 'github'],
    ['https://gitlab.example.com/org/repo.git', 'gitlab'],
    ['https://org@dev.azure.com/org/project/_git/repo', 'azure'],
    ['https://org.visualstudio.com/project/_git/repo', 'azure'],
    ['https://git.example.com/org/repo.git', 'none'],
    ['', 'none']
  ]) {
    if (detectPrHost(url) !== host) {
      throw new Error(`detectPrHost("${url}") should be ${host} (got ${detectPrHost(url)})`);
    }
  }

  const split = splitBuildCommands(['npm install', 'npm run lint', 'npm run build', 'mvn -q package -DskipTests']);
  if (JSON.stringify(split) !== JSON.stringify({ fast: ['npm install', 'npm run lint'], build: ['npm run build', 'mvn -q package -DskipTests'] })) {
    throw new Error(`splitBuildCommands must keep install/static in fast and defer builds (got ${JSON.stringify(split)})`);
  }
  const TEST_LIKE = /\btest\b|pytest/;
  for (const stack of ['python', 'go', 'rust', 'java-maven', 'java-gradle', 'dotnet']) {
    const commands = verificationCommands({ stack });
    if (commands.some((command) => TEST_LIKE.test(command))) {
      throw new Error(`verificationCommands must not detect test commands (${stack}: ${commands.join(', ')})`);
    }
  }
  const nodeCommands = verificationCommands({ stack: 'node', packageJson: { scripts: { lint: 'x', test: 'x', build: 'x' } } });
  if (nodeCommands.some((command) => TEST_LIKE.test(command))) {
    throw new Error(`verificationCommands must skip the package.json test script (got ${nodeCommands.join(', ')})`);
  }

  // --- Commit messages ---------------------------------------------------------
  if (!CONVENTIONAL_COMMIT_TYPES.includes('feat') || !CONVENTIONAL_COMMIT_TYPES.includes('revert')) {
    throw new Error('CONVENTIONAL_COMMIT_TYPES must carry the canonical set');
  }
  const goodCommit = validateCommitMessage('feat: reject blank titles\n\nShows an inline error instead of saving.\n\nTasks: task-001 task-002');
  if (!goodCommit.ok || goodCommit.warnings.length || goodCommit.parts.trailer !== 'Tasks: task-001 task-002') {
    throw new Error(`a well-formed feature commit must validate cleanly (got ${JSON.stringify(goodCommit)})`);
  }
  if (!validateCommitMessage('feat(ui)!: drop legacy layout').ok) {
    throw new Error('scoped and breaking-change subjects must validate');
  }
  if (validateCommitMessage('Add a thing').ok) {
    throw new Error('a non-conventional subject must fail');
  }
  if (!validateCommitMessage('feat: no trailer here').warnings.some((w) => /Tasks:/.test(w))) {
    throw new Error('a feat commit without a Tasks: trailer must soft-warn');
  }
  if (!validateCommitMessage('fix(ci): repair flaky selector').ok) {
    throw new Error('a trailer-less fix commit (CI fix / remediation) must still be valid');
  }

  // --- Feature list validator ----------------------------------------------------
  const base = { approvalMode: 'supervised', integrationBranch: 'main', branchPattern: 'feature/<short-desc>' };
  expectOk(validateFeatureList({ ...base, tasks: [row()] }), 'minimal feature list');

  const missingBranch = validateFeatureList({ tasks: [row()] });
  if (!missingBranch.ok || !missingBranch.warnings.some((w) => /integrationBranch missing/.test(w))) {
    throw new Error('missing integrationBranch must be a soft warning, not tier-1');
  }
  if (!validateFeatureList({ ...base, prHost: 'bitbucket', tasks: [row()] }).warnings.some((w) => /prHost/.test(w))) {
    throw new Error('an unknown prHost must soft-warn');
  }

  expectErrors(validateFeatureList({ ...base, tasks: [row({ featId: undefined })] }), /missing featId/, 'row without featId');
  expectErrors(validateFeatureList({ ...base, tasks: [row({ status: 'in-progress', evidence: 'commit abc1234' })] }), /must not have evidence/, 'evidence on in-progress');
  expectErrors(validateFeatureList({ ...base, tasks: [row({ status: 'done', evidence: 'commit abc1234 — tests passed' })] }), /exactly "commit <hash>"/, 'verbose evidence');
  expectErrors(validateFeatureList({ ...base, tasks: [row({ dependencies: ['task-999'] })] }), /dangling dependency/, 'dangling dependency');
  expectErrors(validateFeatureList({
    ...base,
    tasks: [row({ dependencies: ['task-002'] }), row({ id: 'task-002', dependencies: ['task-001'] })]
  }), /dependency cycle/, 'dependency cycle');

  // Active rows need no external tracker id — local task ids are the only ids.
  expectOk(validateFeatureList({ ...base, tasks: [row({ status: 'in-progress' })] }), 'in-progress row without any external id');

  expectErrors(validateFeatureList({
    ...base,
    tasks: [
      row({ status: 'done', evidence: 'commit abc1234', reviewVerdict: 'pass' }),
      row({ id: 'task-002', status: 'verified' })
    ]
  }), /half-committed/, 'half-committed feature');

  expectOk(validateFeatureList({
    ...base,
    tasks: [row({ status: 'done', evidence: 'commit abc1234', reviewVerdict: 'unverified-accepted' })]
  }), 'feature committed with explicitly accepted unobserved behaviour');
  for (const verdict of ['gaps', 'fail', 'fail-overridden']) {
    expectErrors(validateFeatureList({
      ...base,
      tasks: [row({ status: 'done', evidence: 'commit abc1234', reviewVerdict: verdict })]
    }), /not one of/, `${verdict} is not a committable verdict`);
  }

  expectErrors(validateFeatureList({
    ...base,
    tasks: [
      row({ status: 'done', evidence: 'commit abc1234', reviewVerdict: 'pass' }),
      row({ id: 'task-002', featId: 'feat-002', status: 'done', evidence: 'commit abc1234', reviewVerdict: 'pass' })
    ]
  }), /not from the same feature/, 'two features sharing a hash');

  expectErrors(validateFeatureList({
    ...base,
    tasks: [row({ featureBaseSha: 'abc1234' }), row({ id: 'task-002', featureBaseSha: 'def5678' })]
  }), /different featureBaseSha/, 'mismatched featureBaseSha');

  expectErrors(validateFeatureList({
    ...base,
    tasks: [row({ reviewVerdict: 'pass' }), row({ id: 'task-002', reviewVerdict: 'gaps' })]
  }), /different reviewVerdict/, 'mismatched reviewVerdict');

  expectErrors(validateFeatureList({ ...base, tasks: [row({ status: 'done', evidence: 'commit abc1234' })] }),
    /no reviewVerdict/, 'done feature without a review verdict (the review is the only behaviour check)');

  const legacyRow = validateFeatureList({ ...base, tasks: [row({ verification: 'npm test', requiredTests: ['unit'] })] });
  if (!legacyRow.ok || !legacyRow.warnings.some((w) => /unused/.test(w))) {
    throw new Error('verification/requiredTests on a row must soft-warn as unused, not fail');
  }

  // planFile front-matter must match the row's featId (template writes `featId:`).
  {
    const planRoot = path.join(tempRoot, 'plan-check');
    await mkdir(path.join(planRoot, '.harness', 'plans'), { recursive: true });
    const planPath = path.join(planRoot, '.harness', 'plans', 'feat-001.md');
    await writeFile(planPath, '---\nfeatId: feat-001\nstatus: approved\n---\n\n# Plan\n\n## Acceptance criteria\n\n- x\n\n## Task specs\n\n### task-001 — y\n');
    expectOk(validateFeatureList({ ...base, tasks: [row({ status: 'in-progress', planFile: '.harness/plans/feat-001.md' })] }, { repoRoot: planRoot }), 'plan front-matter featId matches');
    expectErrors(validateFeatureList({
      ...base,
      tasks: [row({ featId: 'feat-002', status: 'in-progress', planFile: '.harness/plans/feat-001.md' })]
    }, { repoRoot: planRoot }), /frontmatter featId does not match/, 'plan front-matter featId mismatch');
    expectErrors(validateFeatureList({
      ...base,
      tasks: [row({ status: 'in-progress', planFile: '.harness/plans/feat-009.md' })]
    }, { repoRoot: planRoot }), /does not exist/, 'missing plan file on an active row');
    await writeFile(planPath, '---\nfeatId: feat-001\n---\n\n# Plan\n');
    const noSpecs = validateFeatureList({ ...base, tasks: [row({ planFile: '.harness/plans/feat-001.md' })] }, { repoRoot: planRoot });
    if (!noSpecs.warnings.some((w) => /Task specs/.test(w))) {
      throw new Error('a plan without "## Task specs" must soft-warn');
    }
  }

  // --- Scaffold ------------------------------------------------------------------
  const repo = path.join(tempRoot, 'repo');
  await mkdir(repo, { recursive: true });
  await writeFile(path.join(repo, 'package.json'), JSON.stringify({
    name: 'self-test-app',
    scripts: { lint: 'node -e "process.exit(0)"', test: 'node -e "process.exit(0)"', build: 'node -e "process.exit(0)"' }
  }, null, 2));
  git(repo, ['init', '-q', '-b', 'main']);
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-qm', 'init']);

  const scaffold = runNode(createScript, ['--target', repo, '--commands', 'node -e "process.exit(0)",npm run build']);
  if (scaffold.status !== 0) {
    console.error(scaffold.stdout);
    console.error(scaffold.stderr);
    throw new Error('workhorse-create.mjs failed with no flags — scaffolding must need no organisation-specific input');
  }

  const features = JSON.parse(await readFile(path.join(repo, 'feature_list.json'), 'utf8'));
  if (features.approvalMode !== 'supervised' || features.integrationBranch !== 'main' || features.branchPattern !== 'feature/<short-desc>') {
    throw new Error(`default scaffold config is wrong (got ${JSON.stringify({ ...features, tasks: undefined })})`);
  }
  for (const name of ['overview-plan.md', 'plan.md', 'ui-build.md']) {
    const copied = await readFile(path.join(repo, '.harness', 'templates', name), 'utf8').catch(() => '');
    if (!copied.includes('## ')) throw new Error(`scaffold must copy ${name} to .harness/templates/ so AGENTS.md pointers resolve`);
  }
  if ('prHost' in features || 'sprintPlanner' in features) {
    throw new Error('default scaffold must not write prHost (detected at runtime) or any tracker block');
  }

  const agents = await readFile(path.join(repo, 'AGENTS.md'), 'utf8');
  if (/\{\{[A-Z_]+\}\}/.test(agents)) {
    throw new Error('scaffolded AGENTS.md still contains unreplaced {{PLACEHOLDERS}}');
  }
  if (!hasHarnessManagedRegion(agents)) {
    throw new Error('scaffolded AGENTS.md must carry harness:managed markers');
  }
  if (!agents.includes('Added by `node init.mjs --build`') || !agents.includes('`npm run build`')) {
    throw new Error('AGENTS.md Verification Commands must list the extra quality-gate commands');
  }
  if (!agents.includes('### Unobserved behaviour') || !agents.includes('writes and runs **no tests**')) {
    throw new Error('AGENTS.md must make the Reviewer the behaviour gate (no tests, unobserved behaviour blocks)');
  }
  if (!agents.includes('.harness/templates/ui-build.md') || !agents.includes('UI from a source, never from nothing')) {
    throw new Error('AGENTS.md must route UI work through .harness/templates/ui-build.md');
  }

  const initFast = spawnSync(process.execPath, [path.join(repo, 'init.mjs')], { cwd: repo, encoding: 'utf8' });
  if (initFast.status !== 0 || /npm run build/.test(initFast.stdout)) {
    throw new Error(`node init.mjs must pass and run the fast tier only (status ${initFast.status})\n${initFast.stdout}${initFast.stderr}`);
  }
  const initBuild = spawnSync(process.execPath, [path.join(repo, 'init.mjs'), '--build'], { cwd: repo, encoding: 'utf8', shell: false });
  if (initBuild.status !== 0 || !/npm run build/.test(initBuild.stdout) || !/Quality Gate Complete/.test(initBuild.stdout)) {
    throw new Error(`node init.mjs --build must run fast + build (status ${initBuild.status})\n${initBuild.stdout}${initBuild.stderr}`);
  }

  const validate = runNode(validateScript, ['--target', repo]);
  if (validate.status !== 0) {
    console.error(validate.stdout);
    throw new Error('a freshly scaffolded harness must pass workhorse-validate.mjs');
  }
  if (!/Overall: 100\/100/.test(validate.stdout)) {
    console.error(validate.stdout);
    throw new Error('a freshly scaffolded harness should score 100/100');
  }

  // Flags are honoured.
  const flagged = path.join(tempRoot, 'flagged');
  const flaggedRun = runNode(createScript, [
    '--target', flagged, '--approval-mode', 'autopilot', '--integration-branch', 'origin/develop',
    '--branch-pattern', 'users/<username>/<short-desc>', '--pr-host', 'gitlab', '--agent-file', 'CLAUDE.md'
  ]);
  if (flaggedRun.status !== 0) throw new Error(`workhorse-create.mjs with flags failed: ${flaggedRun.stderr}`);
  const flaggedFeatures = JSON.parse(await readFile(path.join(flagged, 'feature_list.json'), 'utf8'));
  if (flaggedFeatures.approvalMode !== 'autopilot' || flaggedFeatures.integrationBranch !== 'develop'
    || flaggedFeatures.branchPattern !== 'users/<username>/<short-desc>' || flaggedFeatures.prHost !== 'gitlab') {
    throw new Error(`workhorse-create.mjs did not honour its flags (got ${JSON.stringify({ ...flaggedFeatures, tasks: undefined })})`);
  }
  if (!(await readFile(path.join(flagged, 'CLAUDE.md'), 'utf8')).startsWith('# CLAUDE.md')) {
    throw new Error('--agent-file CLAUDE.md must write CLAUDE.md with its own title');
  }
  if (runNode(createScript, ['--target', path.join(tempRoot, 'bad'), '--approval-mode', 'yolo']).status === 0) {
    throw new Error('workhorse-create.mjs must reject an unknown --approval-mode');
  }
  if (runNode(createScript, ['--target', path.join(tempRoot, 'bad2'), '--pr-host', 'bitbucket']).status === 0) {
    throw new Error('workhorse-create.mjs must reject an unknown --pr-host');
  }

  // Existing files are kept without --force.
  await writeFile(path.join(repo, 'progress.md'), '# mine\n');
  runNode(createScript, ['--target', repo]);
  if ((await readFile(path.join(repo, 'progress.md'), 'utf8')) !== '# mine\n') {
    throw new Error('workhorse-create.mjs must not overwrite existing files without --force');
  }

  // --- Upgrade -------------------------------------------------------------------
  const metadata = await readSkillMetadata();
  const rendered = await renderAgentsFromTemplate({
    AGENT_FILE_NAME: 'AGENTS.md',
    PROJECT_PURPOSE: 'Purpose.',
    VERIFICATION_COMMANDS: '- `node init.mjs`',
    PRIMARY_VERIFICATION_COMMAND: 'node init.mjs'
  });
  const managedBody = extractHarnessManagedRegion(rendered);

  const live = `# AGENTS.md\n\nMy project does X.\n\n## Local rules\n\nNever touch vendor/.\n\n<!-- harness:managed:start -->\nold skill text\n<!-- harness:managed:end -->\n`;
  if (extractProjectPurpose(live) !== 'My project does X.') {
    throw new Error('extractProjectPurpose must read the first paragraph after the title');
  }
  if (!detectManagedRegionEdits(live, managedBody).hasManagedEdits) {
    throw new Error('detectManagedRegionEdits must flag stale managed content');
  }
  const upgraded = composeUpgradedAgentsFile(live, rendered);
  if (upgraded.mode !== 'managed-splice' || !upgraded.content.includes('Never touch vendor/.') || upgraded.content.includes('old skill text')) {
    throw new Error('managed-splice upgrade must keep user content outside markers and replace the managed body');
  }

  const upgradeRoot = path.join(tempRoot, 'upgrade');
  await mkdir(upgradeRoot, { recursive: true });
  const featureListPath = path.join(upgradeRoot, 'feature_list.json');
  await writeFile(featureListPath, JSON.stringify({ tasks: [row()] }, null, 2));
  await writeFile(path.join(upgradeRoot, 'AGENTS.md'), live);

  if (!(await mergeApprovalModeIfMissing(featureListPath)).changed) throw new Error('approvalMode must merge when missing');
  if (!(await mergeBranchPatternIfMissing(featureListPath)).changed) throw new Error('branchPattern must merge when missing');
  if (!(await mergeIntegrationBranchIfMissing(featureListPath, 'main')).changed) throw new Error('integrationBranch must merge when missing');
  if ((await mergeIntegrationBranchIfMissing(featureListPath, 'develop')).changed) {
    throw new Error('mergeIntegrationBranchIfMissing must not overwrite an existing value');
  }
  const merged = JSON.parse(await readFile(featureListPath, 'utf8'));
  if (JSON.stringify(Object.keys(merged)) !== JSON.stringify(['approvalMode', 'integrationBranch', 'branchPattern', 'tasks'])) {
    throw new Error(`merged config keys should stay ordered ahead of tasks (got ${Object.keys(merged).join(', ')})`);
  }

  const manifestWrite = await writeHarnessManifest(upgradeRoot, { agentFile: 'AGENTS.md', version: metadata.version });
  const manifest = JSON.parse(await readFile(manifestWrite.path, 'utf8'));
  if (manifest.workhorseVersion !== metadata.version || !manifest.upgradedAt) {
    throw new Error('manifest must record workhorseVersion and upgradedAt');
  }

  const planRun = runNode(upgradeScript, ['--target', repo, '--json']);
  if (planRun.status !== 0 || JSON.parse(planRun.stdout).readyToApply !== true) {
    throw new Error(`workhorse-upgrade.mjs plan mode must succeed on a scaffolded harness\n${planRun.stdout}${planRun.stderr}`);
  }
  const applyRun = runNode(upgradeScript, ['--target', repo, '--apply', '--json']);
  if (applyRun.status !== 0 || JSON.parse(applyRun.stdout).ok !== true) {
    throw new Error(`workhorse-upgrade.mjs --apply must succeed and re-validate\n${applyRun.stdout}${applyRun.stderr}`);
  }

  const emptyRoot = path.join(tempRoot, 'empty');
  await mkdir(emptyRoot, { recursive: true });
  if (runNode(upgradeScript, ['--target', emptyRoot]).status !== 1) {
    throw new Error('workhorse-upgrade.mjs must exit 1 when no harness is present');
  }

  console.log('harness self-test passed');
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
