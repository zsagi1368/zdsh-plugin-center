/**
 * Supplement b (TC-B4-PC1 ruling condition 3): binary-planting negative
 * control with REAL spawns — under a poisoned cwd holding a planted
 * `dsh.cmd` (win32) / `dsh` (POSIX), executing the bare name `dsh` through
 * the engine's command port must run the PATH-resolved body, never the
 * planted one. This is the reversed leg of the SECURITY-B4-D1a F1 trigger
 * chain (probe E: pre-fix `shell:true` + bare name executed the plant).
 *
 * Red/green record: pre-fix on win32 this spec is RED (the planted dsh.cmd in
 * the process cwd wins cmd.exe's CWD-first search) — see receipt §4.
 */
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { nodePorts } from '../../src/host/ports.js';

let restoreCwd: string | null = null;
let restorePath: string | undefined;

afterEach(() => {
  if (restoreCwd !== null) {
    process.chdir(restoreCwd);
    restoreCwd = null;
  }
  if (restorePath !== undefined) {
    process.env.PATH = restorePath;
    restorePath = undefined;
  }
});

function poisonCwdAndRealPath(): { cwdDir: string; pathDir: string } {
  const root = mkdtempSync(join(tmpdir(), 'pc1-plant-'));
  const cwdDir = join(root, 'cwd');
  const pathDir = join(root, 'path');
  mkdirSync(cwdDir, { recursive: true });
  mkdirSync(pathDir, { recursive: true });
  if (process.platform === 'win32') {
    writeFileSync(
      join(cwdDir, 'dsh.cmd'),
      `@echo off\r\necho planted> "${join(cwdDir, 'marker-planted.txt')}"\r\n`,
      'utf8',
    );
    writeFileSync(
      join(pathDir, 'dsh.cmd'),
      `@echo off\r\necho real> "${join(pathDir, 'marker-real.txt')}"\r\n`,
      'utf8',
    );
  } else {
    const planted = join(cwdDir, 'dsh');
    writeFileSync(planted, `#!/bin/sh\necho planted > "${join(cwdDir, 'marker-planted.txt')}"\n`, 'utf8');
    chmodSync(planted, 0o755);
    const real = join(pathDir, 'dsh');
    writeFileSync(real, `#!/bin/sh\necho real > "${join(pathDir, 'marker-real.txt')}"\n`, 'utf8');
    chmodSync(real, 0o755);
  }
  restoreCwd = process.cwd();
  restorePath = process.env.PATH;
  process.chdir(cwdDir);
  process.env.PATH = `${pathDir}${delimiter}${restorePath ?? ''}`;
  return { cwdDir, pathDir };
}

describe('F1 planting negative control (real spawn, supplement b)', () => {
  it('runs the PATH-resolved dsh body, never the cwd-planted one', async () => {
    const { cwdDir, pathDir } = poisonCwdAndRealPath();
    const outcome = await nodePorts().commands.run({ cmd: 'dsh', args: [] });
    expect(outcome.code).toBe(0);
    expect(existsSync(join(pathDir, 'marker-real.txt'))).toBe(true);
    expect(readFileSync(join(pathDir, 'marker-real.txt'), 'utf8').trim()).toBe('real');
    // The planted body in the poisoned cwd must never have executed.
    expect(existsSync(join(cwdDir, 'marker-planted.txt'))).toBe(false);
  }, 30_000);
});
