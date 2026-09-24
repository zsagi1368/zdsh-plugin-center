import { createHash } from 'node:crypto'
import {
  closeSync,
  copyFileSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeSync,
} from 'node:fs'
import { isAbsolute, join, relative, resolve, dirname } from 'node:path'
import { cpOk, type CpResult } from '../shared/types.js'

function sleepBusy(multiplier: number): void {
  // Synchronous pause for rename retries; short by design.
  const until = Date.now() + multiplier * 40
  while (Date.now() < until) {
    // spin
  }
}

/**
 * Refuse to descend through reparse points: every existing segment between
 * root and path must be a real directory. Junctions need no privileges on
 * Windows, so "predictable dir" plus "attacker-planted junction" equals
 * arbitrary write location.
 */
export function ensureNoReparse(root: string, ...segments: string[]): string {
  const target = resolve(join(resolve(root), ...segments))
  let probe = resolve(root)
  if (lstatSafe(probe)?.isSymbolicLink()) throw new Error(`reparse point at root: ${probe}`)
  for (const segment of segments) {
    probe = join(probe, segment)
    const stats = lstatSafe(probe)
    if (stats !== null && stats.isSymbolicLink()) {
      throw new Error(`reparse point in path: ${probe}`)
    }
  }
  return target
}

function lstatSafe(path: string): import('node:fs').Stats | null {
  try {
    return lstatSync(path)
  } catch {
    return null
  }
}

export interface CommandSpec {
  cmd: string
  args: string[]
}

export interface CommandOutcome {
  code: number
  stdout: string
  stderr: string
}

/** Ports the engine depends on; every one is fake-able in tests. */
export interface EnginePorts {
  fs: FileSystemPort
  commands: CommandPort
  clock: ClockPort
  http: HttpPort
}

export interface FileSystemPort {
  readFile(path: string): string | null
  writeFileAtomic(path: string, contents: string): void
  copyFile(from: string, to: string): void
  mkdirDeep(path: string): void
  hashFile(path: string): string | null
  fileExists(path: string): boolean
  /** Delete a path; symlink/junction links are unlinked, never followed. */
  removePath(path: string): void
}

export interface CommandPort {
  run(spec: CommandSpec): Promise<CommandOutcome>
}

export interface ClockPort {
  now(): Date
}

export interface HttpPort {
  fetchText(url: string, timeoutMs?: number): Promise<CpResult<string>>
}

// ---------------------------------------------------------------- node impls

function sha256File(path: string): string | null {
  try {
    const stats = lstatSync(path)
    if (!stats.isFile()) return null
    return createHash('sha256').update(readFileSync(path)).digest('hex')
  } catch {
    return null
  }
}

/**
 * Containment check that survives Windows cross-drive paths: a cross-drive
 * `path.relative` degenerates into an absolute path, so an absolute result can
 * never count as "inside".
 */
export function isInsideRoot(root: string, target: string): boolean {
  const rel = relative(resolve(root), resolve(target))
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

/**
 * Remove a file or link. Symlinks/junctions are unlinked at the link itself so
 * a delete can never follow into the target tree.
 */
function removePathSafe(path: string): void {
  let stats
  try {
    stats = lstatSync(path)
  } catch {
    return // already gone
  }
  if (stats.isSymbolicLink()) {
    unlinkSync(path)
    return
  }
  if (stats.isDirectory()) {
    rmSync(path, { recursive: true })
    return
  }
  unlinkSync(path)
}

/**
 * Argument allowlist gate — defined in shared/resolve-executable.ts together
 * with the spawn-carrier planner (the allowlist is the safety premise of the
 * win32 verbatim carrier); re-exported here to keep the historical import
 * path stable.
 */
export { assertSafeArgs } from '../shared/resolve-executable.js'
import { assertSafeArgs, planCommand } from '../shared/resolve-executable.js'

function runViaSpawn(spec: CommandSpec): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolvePromise, rejectPromise) => {
    assertSafeArgs([spec.cmd, ...spec.args])
    // Lazy import keeps this module importable in non-node test sandboxes.
    // F1 (SECURITY-B4-D1a, ruling 1b): the command name is resolved to an
    // absolute path (where.exe/which, fail-closed — a resolution failure
    // rejects this promise with guidance instead of falling back to the bare
    // name) and the carrier is planned shell-free: real executables spawn
    // directly, win32 .cmd/.bat shims run through an absolute cmd.exe with
    // windowsVerbatimArguments. spawn options are always shell:false and the
    // spawned file is always absolute — see shared/resolve-executable.ts.
    Promise.all([import('node:child_process'), planCommand(spec.cmd, spec.args)]).then(
      ([{ spawn }, invocation]) => {
        const child = spawn(invocation.file, invocation.args, invocation.options)
        let stdout = ''
        let stderr = ''
        child.stdout.on('data', (chunk: Buffer) => {
          stdout += chunk.toString()
        })
        child.stderr.on('data', (chunk: Buffer) => {
          stderr += chunk.toString()
        })
        child.on('error', rejectPromise)
        child.on('close', (code) => {
          resolvePromise({ code: code ?? -1, stdout, stderr })
        })
      },
      rejectPromise,
    )
  })
}

export function nodePorts(): EnginePorts {
  const clock: ClockPort = { now: () => new Date() }
  const fs: FileSystemPort = {
    readFile(path) {
      try {
        return readFileSync(path, 'utf8')
      } catch {
        return null
      }
    },
    writeFileAtomic(path, contents) {
      const dir = dirname(path)
      mkdirSync(dir, { recursive: true })
      // Exclusive temp creation: a predictable-but-preplanted temp name can
      // never be hijacked, and EEXIST just picks the next candidate.
      let handle: number | null = null
      let tmp = ''
      for (let attempt = 0; attempt < 5 && handle === null; attempt += 1) {
        tmp = join(dir, `.${Date.now()}-${attempt}-${Math.floor(Math.random() * 0xffffffff).toString(36)}.tmp`)
        try {
          handle = openSync(tmp, 'wx')
        } catch {
          handle = null
        }
      }
      if (handle === null) throw new Error('writeFileAtomic: cannot create exclusive temp file')
      try {
        writeSync(handle, contents, 0, 'utf8')
      } finally {
        closeSync(handle)
      }
      // AV scanners / indexers briefly hold fresh files on Windows; retry
      // instead of failing the whole transaction.
      let lastError: unknown
      for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
          renameSync(tmp, path)
          return
        } catch (error) {
          lastError = error
          const code = (error as { code?: string }).code
          if (code !== 'EPERM' && code !== 'EACCES') break
          sleepBusy(attempt + 1)
        }
      }
      try {
        unlinkSync(tmp)
      } catch {
        // best effort
      }
      throw lastError instanceof Error ? lastError : new Error('writeFileAtomic failed')
    },
    copyFile(from, to) {
      mkdirSync(dirname(to), { recursive: true })
      // Never write *through* a planted link at the destination.
      const existing = lstatSafe(to)
      if (existing !== null && existing.isSymbolicLink()) unlinkSync(to)
      copyFileSync(from, to)
    },
    mkdirDeep(path) {
      mkdirSync(path, { recursive: true })
    },
    hashFile: sha256File,
    fileExists(path) {
      try {
        return statSync(path).isFile()
      } catch {
        return false
      }
    },
    removePath: removePathSafe,
  }
  const commands: CommandPort = { run: runViaSpawn }
  const http: HttpPort = {
    async fetchText(url, timeoutMs) {
      const { safeFetch } = await import('../shared/ssrc-guard.js')
      const result = await safeFetch(url, { timeoutMs })
      if (!result.ok) return result
      return cpOk(result.data.text)
    },
  }
  return { fs, commands, clock, http }
}
