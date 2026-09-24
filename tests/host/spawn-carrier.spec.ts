/**
 * F1 locks (TC-B4-PC1 / SECURITY-B4-D1a F1 [阻断], ruling 1b).
 *
 * Invariants locked here (ruling condition 3 — four existing + supplement a):
 *   L1  spawn options always carry `shell === false`;
 *   L2  the spawned file is always an absolute path;
 *   L3  an unresolvable bare name is refused BEFORE any spawn (fail-closed,
 *       never falls back to the bare name);
 *   L4  a relative command path is refused before any spawn;
 *   L3a (supplement a) the win32 `.cmd`/`.bat` carrier branch spawns an
 *       absolute cmd.exe with `/d /s /c` + `windowsVerbatimArguments`.
 *
 * Red/green record: this spec was first run against the pre-fix code where
 * L1/L2 fail (actual shape: `spawn('dsh', args, { shell: true })`) and
 * L3/L4 fail (bare/relative names reach spawn untouched) — see receipt §4.
 */
import { EventEmitter } from 'node:events';
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { win32, posix } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  spawnCalls: [] as Array<{ file: string; args: string[]; options: Record<string, unknown> }>,
  spawnSyncCalls: [] as Array<{ file: string; args: string[]; options: Record<string, unknown> }>,
  spawnSyncResult: { status: 0, stdout: '', stderr: '' } as {
    status: number | null;
    stdout: string;
    stderr: string;
    error?: Error;
  },
}));

vi.mock('node:child_process', () => ({
  spawn: (file: string, args: string[], options: Record<string, unknown>) => {
    h.spawnCalls.push({ file, args, options });
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      pid: number;
      unref: () => void;
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.pid = 4242;
    child.unref = () => {};
    queueMicrotask(() => child.emit('close', 0));
    return child;
  },
  spawnSync: (file: string, args: string[], options: Record<string, unknown>) => {
    h.spawnSyncCalls.push({ file, args, options });
    return h.spawnSyncResult;
  },
}));

import { nodePorts } from '../../src/host/ports.js';
import { assertSafeArgs } from '../../src/host/ports.js';
import {
  comSpecAbsolute,
  planSpawnInvocation,
  resolveExecutablePath,
} from '../../src/shared/resolve-executable.js';

const run = (spec: { cmd: string; args: string[] }) => nodePorts().commands.run(spec);

function isAbsPlatform(p: string): boolean {
  return process.platform === 'win32' ? win32.isAbsolute(p) : posix.isAbsolute(p);
}

/** A real on-disk fixture so existsSync checks in the resolver pass hermetically. */
function makeResolvedFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pc1-resolve-'));
  if (process.platform === 'win32') {
    const file = join(dir, 'dsh.cmd');
    writeFileSync(file, '@echo off\r\n', 'utf8');
    return file;
  }
  const file = join(dir, 'dsh');
  writeFileSync(file, '#!/bin/sh\nexit 0\n', 'utf8');
  chmodSync(file, 0o755);
  return file;
}

let resolvedFixture = '';

beforeEach(() => {
  h.spawnCalls.length = 0;
  h.spawnSyncCalls.length = 0;
  resolvedFixture = makeResolvedFixture();
  h.spawnSyncResult = { status: 0, stdout: `${resolvedFixture}\n`, stderr: '' };
});

describe('F1 spawn-surface locks', () => {
  it('L1+L2: a resolvable command spawns with shell===false and an absolute file', async () => {
    const outcome = await run({ cmd: 'dsh', args: ['plugin', '--profile', 'web', 'remove', 'x'] });
    expect(outcome.code).toBe(0);
    expect(h.spawnCalls).toHaveLength(1);
    const call = h.spawnCalls[0]!;
    // L1 — the pre-fix shape was { shell: true }; the lock pins shell===false.
    expect(call.options.shell).toBe(false);
    // L2 — the pre-fix shape spawned the bare name 'dsh'; the lock pins absolute.
    expect(isAbsPlatform(call.file)).toBe(true);
    if (process.platform === 'win32') {
      // Supplement a: .cmd carrier goes through an absolute cmd.exe, verbatim.
      expect(call.options.windowsVerbatimArguments).toBe(true);
      expect(call.args.slice(0, 3)).toEqual(['/d', '/s', '/c']);
      const payload = String(call.args[3]);
      expect(payload.startsWith('"')).toBe(true);
      expect(payload.endsWith('"')).toBe(true);
      expect(payload).toContain(resolvedFixture);
      expect(payload).toContain('plugin --profile web remove x');
    } else {
      expect(call.file).toBe(resolvedFixture);
      expect(call.args).toEqual(['plugin', '--profile', 'web', 'remove', 'x']);
      expect(call.options.windowsVerbatimArguments).toBeUndefined();
    }
  });

  it('L3: an unresolvable bare name is refused before any spawn (fail-closed, no bare fallback)', async () => {
    h.spawnSyncResult = { status: 1, stdout: '', stderr: 'INFO: Could not find files' };
    await expect(run({ cmd: 'dsh-definitely-not-installed-xyz', args: [] })).rejects.toThrow(
      /resolution failed/i,
    );
    expect(h.spawnCalls).toHaveLength(0);
  });

  it('L3b: a where.exe/which miss that echoes a non-absolute line is still refused', async () => {
    // where.exe echoes the bare name on some miss shapes; only absolute
    // results are usable (mainline git-runner lesson).
    h.spawnSyncResult = { status: 0, stdout: 'dsh\n', stderr: '' };
    await expect(run({ cmd: 'dsh', args: [] })).rejects.toThrow(/refus|resolution failed/i);
    expect(h.spawnCalls).toHaveLength(0);
  });

  it('L4: a relative command path is refused before any spawn', async () => {
    await expect(run({ cmd: './dsh', args: [] })).rejects.toThrow(/relative/i);
    expect(h.spawnCalls).toHaveLength(0);
    await expect(run({ cmd: 'tools\\dsh', args: [] })).rejects.toThrow(/relative/i);
    expect(h.spawnCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Unit surface of the resolver + carrier planner (post-fix green phase; the
// red phase of the four locks above is recorded in receipt §4).
// ---------------------------------------------------------------------------

const realPlatform = process.platform;

function stubPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
}

afterEach(() => {
  stubPlatform(realPlatform);
  vi.unstubAllEnvs();
});

/** Create an on-disk fixture file and return its absolute path. */
function fixtureFile(name: string, contents = 'x'): string {
  const dir = mkdtempSync(join(tmpdir(), 'pc1-fixture-'));
  const file = join(dir, name);
  writeFileSync(file, contents, 'utf8');
  return file;
}

describe('SAFE_ARG × cmd.exe metacharacter coverage (ruling supplement, anti-drift lock)', () => {
  // The verbatim win32 carrier embeds argv in a cmd.exe command line; its
  // safety premise is that SAFE_ARG excludes every cmd metacharacter. If the
  // charset ever drifts to allow one of these, this lock fails first.
  const cmdMetachars = ['&', '|', '<', '>', '"', "'", '%', '^', '!', '(', ')', ';', '\n', '\r', '`', '$', '*', '?'];
  for (const ch of cmdMetachars) {
    it(`refuses ${JSON.stringify(ch)} in any argv slot`, () => {
      expect(() => assertSafeArgs([`plugin${ch}calc`])).toThrow(/unsafe command argument/);
    });
  }
  it('keeps the legitimate argv shapes passing (spaces, git URLs, npm specs)', () => {
    expect(() =>
      assertSafeArgs([
        'plugin',
        '--profile',
        'my profile',
        'add',
        'git+https://github.com/owner/repo.git#aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        'pkg@1.2.3',
      ]),
    ).not.toThrow();
  });
});

describe('resolveExecutablePath (fail-closed matrix)', () => {
  it('refuses empty names', async () => {
    await expect(resolveExecutablePath('   ')).rejects.toThrow(/empty command name/);
  });

  it('refuses relative paths', async () => {
    await expect(resolveExecutablePath('./dsh')).rejects.toThrow(/relative command paths are refused/);
    await expect(resolveExecutablePath('..\\tools\\dsh')).rejects.toThrow(/relative/);
  });

  it('refuses absolute paths that do not exist', async () => {
    const missing = process.platform === 'win32' ? 'C:\\no\\such\\dsh.cmd' : '/no/such/dsh';
    await expect(resolveExecutablePath(missing)).rejects.toThrow(/does not exist/);
  });

  it('accepts a validated absolute path unchanged', async () => {
    if (process.platform === 'win32') {
      const file = fixtureFile('dsh.cmd', '@echo off\r\n');
      await expect(resolveExecutablePath(file)).resolves.toBe(file);
      const bare = fixtureFile('dsh'); // extensionless is NOT executable on win32
      await expect(resolveExecutablePath(bare)).rejects.toThrow(/not a win32 executable form/);
    } else {
      const file = fixtureFile('dsh', '#!/bin/sh\n');
      chmodSync(file, 0o755);
      await expect(resolveExecutablePath(file)).resolves.toBe(file);
      const noExec = fixtureFile('dsh-noexec', '#!/bin/sh\n');
      await expect(resolveExecutablePath(noExec)).rejects.toThrow(/not executable/);
    }
  });

  it('bare name: probe miss (non-zero exit) throws with guidance, never falls back', async () => {
    h.spawnSyncResult = { status: 1, stdout: '', stderr: 'miss' };
    await expect(resolveExecutablePath('dsh')).rejects.toThrow(
      process.platform === 'win32' ? /where\.exe exited 1/ : /which exited 1/,
    );
  });

  it('bare name: probe unavailable (spawn error / throw) is fail-closed', async () => {
    h.spawnSyncResult = { status: null, stdout: '', stderr: '', error: new Error('EPERM blocked') };
    await expect(resolveExecutablePath('dsh')).rejects.toThrow(/unavailable/);
  });

  it('bare name: non-absolute probe output is a miss, not a result', async () => {
    h.spawnSyncResult = { status: 0, stdout: 'dsh\n', stderr: '' };
    await expect(resolveExecutablePath('dsh')).rejects.toThrow(
      process.platform === 'win32' ? /no absolute executable candidate/ : /no usable absolute path/,
    );
  });

  it('win32: probe cwd is pinned to SystemRoot so the host cwd cannot shadow the lookup', async () => {
    stubPlatform('win32');
    const systemRoot = fixtureFile('systemroot-marker').replace(/systemroot-marker$/, '');
    vi.stubEnv('SystemRoot', systemRoot);
    const resolved = fixtureFile('dsh.cmd');
    h.spawnSyncResult = { status: 0, stdout: `${resolved}\n`, stderr: '' };
    await expect(resolveExecutablePath('dsh')).resolves.toBe(resolved);
    expect(h.spawnSyncCalls.length).toBeGreaterThan(0);
    const probe = h.spawnSyncCalls[h.spawnSyncCalls.length - 1]!;
    expect(probe.file).toBe('where.exe');
    expect(probe.args).toEqual(['dsh']);
    expect(probe.options.cwd).toBe(systemRoot);
  });

  it('win32: extensionless echoes are skipped and .exe outranks .cmd shims', async () => {
    stubPlatform('win32');
    const dir = mkdtempSync(join(tmpdir(), 'pc1-rank-'));
    const extensionless = join(dir, 'dsh');
    const shim = join(dir, 'dsh.cmd');
    const real = join(dir, 'dsh.exe');
    for (const f of [extensionless, shim, real]) writeFileSync(f, 'x', 'utf8');
    // where.exe lists in its own order; the resolver must rank, not first-line.
    h.spawnSyncResult = { status: 0, stdout: `${extensionless}\n${shim}\n${real}\n`, stderr: '' };
    await expect(resolveExecutablePath('dsh')).resolves.toBe(real);
    // Without the .exe present the shim is the carrier.
    h.spawnSyncResult = { status: 0, stdout: `${extensionless}\n${shim}\n`, stderr: '' };
    await expect(resolveExecutablePath('dsh')).resolves.toBe(shim);
  });
});

describe('comSpecAbsolute (ruling condition 1: absolute interpreter only)', () => {
  it('accepts an absolute existing ComSpec', () => {
    stubPlatform('win32');
    const cmd = fixtureFile('cmd.exe');
    vi.stubEnv('ComSpec', cmd);
    expect(comSpecAbsolute()).toBe(cmd);
  });

  it('refuses a bare/relative ComSpec and falls back to SystemRoot\\System32\\cmd.exe', () => {
    stubPlatform('win32');
    const systemRoot = mkdtempSync(join(tmpdir(), 'pc1-sysroot-'));
    const realCmd = join(systemRoot, 'System32', 'cmd.exe');
    mkdirSync(join(systemRoot, 'System32'), { recursive: true });
    writeFileSync(realCmd, 'x', 'utf8');
    vi.stubEnv('ComSpec', 'cmd.exe'); // bare value = re-enters CWD search → must be refused
    vi.stubEnv('SystemRoot', systemRoot);
    vi.stubEnv('WINDIR', '');
    expect(comSpecAbsolute()).toBe(realCmd);
    vi.stubEnv('ComSpec', '  ');
    expect(comSpecAbsolute()).toBe(realCmd);
  });

  it('throws fail-closed when no absolute interpreter exists anywhere', async () => {
    // Posix-gated: on a real Windows box C:\Windows\System32\cmd.exe always
    // exists as the last resort, so the throw path is only reachable here.
    if (process.platform === 'win32') return;
    stubPlatform('win32');
    vi.stubEnv('ComSpec', '');
    vi.stubEnv('SystemRoot', '');
    vi.stubEnv('WINDIR', '');
    expect(() => comSpecAbsolute()).toThrow(/no absolute cmd\.exe interpreter available/);
  });
});

describe('planSpawnInvocation carrier shapes', () => {
  it('win32 .cmd shim → absolute cmd.exe /d /s /c with verbatim args and per-token quoting', () => {
    stubPlatform('win32');
    const cmd = fixtureFile('cmd.exe');
    vi.stubEnv('ComSpec', cmd);
    const shim = fixtureFile('dsh.cmd');
    const plan = planSpawnInvocation(shim, ['plugin', '--profile', 'my profile', 'remove', 'x']);
    expect(plan.file).toBe(cmd);
    expect(plan.args.slice(0, 3)).toEqual(['/d', '/s', '/c']);
    // Outer quote wraps the whole command line (cmd /s strips first+last);
    // whitespace tokens carry their own quotes (mirrors Node's shell:true quoter).
    const quote = (token: string) => (token === '' || /[\t ]/.test(token) ? `"${token}"` : token);
    const commandLine = [shim, 'plugin', '--profile', 'my profile', 'remove', 'x'].map(quote).join(' ');
    expect(plan.args[3]).toBe(`"${commandLine}"`);
    expect(plan.options).toEqual({ shell: false, windowsHide: true, windowsVerbatimArguments: true });
  });

  it('win32 .exe → direct spawn, no interpreter, no verbatim flag', () => {
    stubPlatform('win32');
    const exe = fixtureFile('dsh.exe');
    const plan = planSpawnInvocation(exe, ['web']);
    expect(plan.file).toBe(exe);
    expect(plan.args).toEqual(['web']);
    expect(plan.options).toEqual({ shell: false, windowsHide: true });
  });

  it('refuses a non-absolute file and unsafe args before planning', () => {
    stubPlatform('win32');
    expect(() => planSpawnInvocation('dsh.cmd', [])).toThrow(/must be an absolute path/);
    const shim = fixtureFile('dsh.cmd');
    expect(() => planSpawnInvocation(shim, ['plugin', '&', 'calc'])).toThrow(/unsafe command argument/);
  });

  it('posix executable → direct spawn with shell:false', () => {
    stubPlatform('posix' as NodeJS.Platform);
    // Literal posix path: the planner does no fs probing, and a windows-style
    // fixture path would not satisfy posix.isAbsolute on a win32 CI host.
    const plan = planSpawnInvocation('/usr/local/bin/dsh', ['plugin', 'add', 'pkg@1.0.0']);
    expect(plan.file).toBe('/usr/local/bin/dsh');
    expect(plan.args).toEqual(['plugin', 'add', 'pkg@1.0.0']);
    expect(plan.options.shell).toBe(false);
    expect(plan.options.windowsVerbatimArguments).toBeUndefined();
  });
});
