import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  copyFileSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  lstatSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { isAbsolute, join, relative, resolve, dirname } from 'node:path';
import { cpOk, type CpResult } from '../shared/types.js';

export interface CommandSpec {
  cmd: string;
  args: string[];
}

export interface CommandOutcome {
  code: number;
  stdout: string;
  stderr: string;
}

/** Ports the engine depends on; every one is fake-able in tests. */
export interface EnginePorts {
  fs: FileSystemPort;
  commands: CommandPort;
  clock: ClockPort;
  http: HttpPort;
}

export interface FileSystemPort {
  readFile(path: string): string | null;
  writeFileAtomic(path: string, contents: string): void;
  copyFile(from: string, to: string): void;
  mkdirDeep(path: string): void;
  hashFile(path: string): string | null;
  fileExists(path: string): boolean;
  /** Delete a path; symlink/junction links are unlinked, never followed. */
  removePath(path: string): void;
}

export interface CommandPort {
  run(spec: CommandSpec): Promise<CommandOutcome>;
}

export interface ClockPort {
  now(): Date;
}

export interface HttpPort {
  fetchText(url: string, timeoutMs?: number): Promise<CpResult<string>>;
}

// ---------------------------------------------------------------- node impls

function sha256File(path: string): string | null {
  try {
    const stats = lstatSync(path);
    if (!stats.isFile()) return null;
    return createHash('sha256').update(readFileSync(path)).digest('hex');
  } catch {
    return null;
  }
}

/**
 * Containment check that survives Windows cross-drive paths: a cross-drive
 * `path.relative` degenerates into an absolute path, so an absolute result can
 * never count as "inside".
 */
export function isInsideRoot(root: string, target: string): boolean {
  const rel = relative(resolve(root), resolve(target));
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

/**
 * Remove a file or link. Symlinks/junctions are unlinked at the link itself so
 * a delete can never follow into the target tree.
 */
function removePathSafe(path: string): void {
  let stats;
  try {
    stats = lstatSync(path);
  } catch {
    return; // already gone
  }
  if (stats.isSymbolicLink()) {
    unlinkSync(path);
    return;
  }
  if (stats.isDirectory()) {
    rmSync(path, { recursive: true });
    return;
  }
  unlinkSync(path);
}

function runViaSpawn(spec: CommandSpec): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolvePromise, rejectPromise) => {
    // Lazy import keeps this module importable in non-node test sandboxes.
    import('node:child_process').then(({ spawn }) => {
      // shell:true is mandatory on win32 where npm-family CLIs are .cmd shims.
      const child = spawn(spec.cmd, spec.args, { shell: true, windowsHide: true });
      let stdout = '';
      let stderr = '';
      child.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      child.on('error', rejectPromise);
      child.on('close', (code) => resolvePromise({ code: code ?? -1, stdout, stderr }));
    }, rejectPromise);
  });
}

export function nodePorts(): EnginePorts {
  const clock: ClockPort = { now: () => new Date() };
  const fs: FileSystemPort = {
    readFile(path) {
      try {
        return readFileSync(path, 'utf8');
      } catch {
        return null;
      }
    },
    writeFileAtomic(path, contents) {
      const dir = dirname(path);
      mkdirSync(dir, { recursive: true });
      const tmp = join(dir, `.${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`);
      writeFileSync(tmp, contents, 'utf8');
      renameSync(tmp, path);
    },
    copyFile(from, to) {
      mkdirSync(dirname(to), { recursive: true });
      copyFileSync(from, to);
    },
    mkdirDeep(path) {
      mkdirSync(path, { recursive: true });
    },
    hashFile: sha256File,
    fileExists(path) {
      try {
        return statSync(path).isFile();
      } catch {
        return false;
      }
    },
    removePath: removePathSafe,
  };
  const commands: CommandPort = { run: runViaSpawn };
  const http: HttpPort = {
    async fetchText(url, timeoutMs) {
      const { safeFetch } = await import('../shared/ssrc-guard.js');
      const result = await safeFetch(url, { timeoutMs });
      if (!result.ok) return result;
      return cpOk(result.data.text);
    },
  };
  return { fs, commands, clock, http };
}
