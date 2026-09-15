/**
 * Minimal stand-in for the official `dsh` CLI used by integration tests.
 *
 * Supported surface (argv shape AND profile-argument semantics mirror the
 * real command — CP-1b: the previous fixture accepted `--profile <dir>`,
 * the opposite of the real CLI, which masked the CP-1 hard break):
 *   node fake-dsh.mjs plugin --profile <name> add    <git+https://...#sha | name@version>
 *   node fake-dsh.mjs plugin --profile <name> remove <pkg>
 *
 * Name semantics mirror app-boot `resolveProfileDir`: the value is a bare
 * profile NAME — empty, '.', '..', 'node_modules' or anything containing a
 * path separator is rejected with the launcher's `invalid profile name`
 * error. The profile directory is resolved as `$FAKE_DSH_HOME/profiles/<name>`
 * (same layout as the real `$DSH_HOME/profiles/<name>`), and — like the real
 * CLI — is initialized with a minimal package.json when absent.
 *
 * Behavior beyond the name gate: mutates <dir>/package.json dependencies and
 * materializes a node_modules/<pkg>/package.json marker. FAKE_DSH_MODE=fail
 * exits non-zero before touching anything so rollback paths can be exercised.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const argv = process.argv.slice(2);
if (process.env.FAKE_DSH_MODE === 'fail') {
  console.error('fake-dsh: forced failure');
  process.exit(1);
}

function fail(message) {
  console.error(`fake-dsh: ${message}`);
  process.exit(2);
}

/** Mirror of app-boot resolveProfileDir's rejection surface (CP-1b). */
function isValidProfileName(name) {
  return !(
    name === ''
    || name.includes('/')
    || name.includes('\\')
    || name === '.'
    || name === '..'
    || name === 'node_modules'
  );
}

const pluginIndex = argv.indexOf('plugin');
if (pluginIndex === -1 || argv[pluginIndex + 1] !== '--profile') fail('expected: plugin --profile <name>');
const profileName = argv[pluginIndex + 2];
const verb = argv[pluginIndex + 3];
const operand = argv[pluginIndex + 4];
if (!isValidProfileName(String(profileName ?? ''))) {
  fail(`invalid profile name ${JSON.stringify(profileName)}`);
}
const home = process.env.FAKE_DSH_HOME;
if (!home) fail('FAKE_DSH_HOME is not set (integration harness must provide the storage home)');
const profileDir = join(home, 'profiles', profileName);
if (!operand) fail('missing target operand');

// The real CLI initializes a fresh profile before forwarding to pnpm.
const pkgPath = join(profileDir, 'package.json');
if (!existsSync(profileDir)) mkdirSync(profileDir, { recursive: true });
if (!existsSync(pkgPath)) writeFileSync(pkgPath, `${JSON.stringify({ dependencies: {} }, null, 2)}\n`, 'utf8');

function parseTarget(target) {
  const gitMatch = target.match(/^git\+https:\/\/github\.com\/([^/]+)\/([^/]+)\.git#([0-9a-f]{40})$/);
  if (gitMatch) {
    return { name: gitMatch[2], reference: gitMatch[3].slice(0, 10) };
  }
  const at = target.lastIndexOf('@');
  if (at > 0) return { name: target.slice(0, at), reference: target.slice(at + 1) };
  return { name: target, reference: '*' };
}

const manifest = JSON.parse(readFileSync(pkgPath, 'utf8'));
manifest.dependencies = manifest.dependencies ?? {};
const markerRoot = join(profileDir, 'node_modules');

if (verb === 'add') {
  const { name, reference } = parseTarget(operand);
  manifest.dependencies[name] = reference;
  const markerDir = join(markerRoot, name);
  mkdirSync(markerDir, { recursive: true });
  writeFileSync(join(markerDir, 'package.json'), JSON.stringify({ name, version: reference }), 'utf8');
  writeFileSync(pkgPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  process.exit(0);
}

if (verb === 'remove') {
  delete manifest.dependencies[operand];
  writeFileSync(pkgPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  rmSync(join(markerRoot, operand), { recursive: true, force: true });
  process.exit(0);
}

fail(`unknown verb: ${String(verb)}`);
