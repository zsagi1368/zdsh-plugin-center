/**
 * True-host contract case (TC-B3-32C commit #2, closing 32B receipt L1):
 * the stub surface in `src/host/plans.ts` / `src/host/services.ts` is a
 * hand-mirror of the mainline launcher's `resolveProfileDir`
 * (`zDSH-main/packages/boot/app-boot/src/profile.ts`). Two mirrors can drift
 * from the original silently, so this spec imports the REAL function (node
 * direct call, read-only, no CLI process, no spawn) and locks CP-1 semantics
 * from both ends:
 *
 * 1. the bare NAME hub hands `dsh plugin --profile` resolves, through the
 *    real launcher, to exactly the directory hub computes itself;
 * 2. a directory-shaped name (absolute path in any OS flavor) must throw in
 *    the real launcher — the plan layer must never stage such a name;
 * 3. the stub predicate `isValidProfileName` and the real throw-surface
 *    agree on a widened corpus — stub/real behavior parity is the core
 *    assertion of this case.
 *
 * The main-repo path is resolved relative to this file (the campaign's
 * fixed sibling layout, BRIEF.md anchors). A missing/unreadable mainline
 * file fails the test loudly — an honest red, never a silent skip.
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cliProfileDir, normalizeConfig } from '../../src/host/services.js';
import { isValidProfileName } from '../../src/host/plans.js';

interface LauncherProfileModule {
  resolveProfileDir(name: string, home?: string): string;
  PROFILES_DIR: string;
}

// tests/integration → tests → PluginCenter → zDSH-plugins → zDSH, then the
// mainline clone sits at zDSH-main (BRIEF key-path anchor).
const LAUNCHER_PROFILE_URL = new URL(
  '../../../../zDSH-main/packages/boot/app-boot/src/profile.ts',
  import.meta.url,
);

let launcher: LauncherProfileModule;
let tempHome: string;

beforeAll(async () => {
  const mainPath = fileURLToPath(LAUNCHER_PROFILE_URL);
  if (!existsSync(mainPath)) {
    throw new Error(
      `true-host contract needs the mainline clone at ${mainPath}; `
      + 'run this suite from a workspace that carries zDSH-main as the sibling of zDSH-plugins',
    );
  }
  // Real code, imported once, no stub duplication (V2 §5-1 non-fake rule).
  launcher = (await import(pathToFileURL(mainPath).href)) as LauncherProfileModule;
  tempHome = mkdtempSync(join(tmpdir(), 'pc-contract-home-'));
});

afterAll(() => {
  rmSync(tempHome, { recursive: true, force: true });
});

/** Names that must resolve identically through hub's mirror and the launcher. */
const NAME_HOME_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['web', '/tmp/pc-home-a'],
  ['headless', '/tmp/pc-home-b'],
  ['sdk-minimal', '/tmp/pc home c'],
  ['a.b', '/tmp/pc-home-d'],
  ['a_b', '/tmp/pc-home-e'],
  ['2', '/tmp/pc-home-f'],
];

describe('hub profile-directory mirror vs real launcher resolveProfileDir', () => {
  it('exports the PROFILES_DIR segment hub hardcodes in cliProfileDir', () => {
    expect(typeof launcher.resolveProfileDir).toBe('function');
    // services.ts joins the literal 'profiles'; a mainline rename must go red here.
    expect(launcher.PROFILES_DIR).toBe('profiles');
  });

  it('resolves the bare name hub passes to exactly the directory hub computes', () => {
    for (const [name, home] of NAME_HOME_PAIRS) {
      const hubDir = cliProfileDir(normalizeConfig({ defaultProfile: name, dshHome: home }));
      expect(launcher.resolveProfileDir(name, home)).toBe(hubDir);
    }
  });

  it('accepts every name the plan-layer predicate accepts (real never throws)', () => {
    for (const [name] of NAME_HOME_PAIRS) {
      expect(isValidProfileName(name)).toBe(true);
      expect(() => launcher.resolveProfileDir(name, tempHome)).not.toThrow();
    }
  });
});

describe('dir-shaped profile names are refused on both ends (bidirectional lock)', () => {
  const DIRECTORY_SHAPED: readonly string[] = [
    '/abs',
    '/tmp/pc-home-a/profiles/web',
    'C:\\x',
    'C:\\x\\profiles\\web',
    'a/b',
    'a\\b',
    '',
    '.',
    '..',
    'node_modules',
  ];

  it('the real launcher throws for every directory-shaped or reserved name', () => {
    for (const name of DIRECTORY_SHAPED) {
      expect(() => launcher.resolveProfileDir(name, tempHome), name).toThrow();
    }
  });

  it('the hub mirror rejects the same set, so a plan can never carry it', () => {
    for (const name of DIRECTORY_SHAPED) {
      expect(isValidProfileName(name), name).toBe(false);
    }
  });
});

describe('stub/real behavior parity on a widened name corpus', () => {
  // Beyond the two pinned lists above: cases where a naive mirror could drift
  // (case variations, whitespace, trailing separators, drive letters, UNC).
  const CORPUS: readonly string[] = [
    'web',
    'Web',
    'web ',
    ' web',
    'web/',
    'web\\',
    'a:b',
    'd:',
    '@scope/pkg',
    '\\\\server\\share',
    '...',
    'NODE_MODULES',
    'node_modules ',
    'node_modules/x',
    '../web',
    '..\\web',
    '/',
    '\\',
    './web',
    'a'.repeat(64),
    'ünicode-ünï',
  ];

  it('isValidProfileName(name) === !throws(real resolveProfileDir(name))', () => {
    expect(launcher.PROFILES_DIR).toBe('profiles');
    for (const name of CORPUS) {
      let realAccepts = true;
      try {
        const dir = launcher.resolveProfileDir(name, tempHome);
        // Whatever the launcher accepts must at least live under <home>/profiles.
        expect(dir.startsWith(join(tempHome, 'profiles'))).toBe(true);
      } catch {
        realAccepts = false;
      }
      expect(isValidProfileName(name), `parity for ${JSON.stringify(name)}`).toBe(realAccepts);
    }
  });
});
