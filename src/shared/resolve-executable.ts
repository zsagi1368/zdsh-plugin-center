/**
 * Executable resolution and spawn-carrier planning (TC-B4-PC1 F1, ruling 1b).
 *
 * zdsh-security-patterns ⑦: spawn must never take a bare command name. A
 * bare name goes through cmd.exe/PATH search order on Windows (CWD before
 * PATH), so a `dsh.cmd` planted in an untrusted working directory wins over
 * the real CLI — the SECURITY-B4-D1a F1 [阻断] trigger chain. Every spawn in
 * this package therefore:
 *
 * 1. resolves the command to an ABSOLUTE path — `where.exe` on win32 with
 *    the probe cwd pinned to SystemRoot (so the host's cwd can never shadow
 *    the lookup), `which` on POSIX; a failed resolution is a hard error
 *    (fail-closed: never falls back to the bare name);
 * 2. plans the spawn carrier: a real executable spawns directly with
 *    `shell:false`; a win32 `.cmd`/`.bat` shim (the npm-family CLI form —
 *    spawning a `.cmd` bare with `shell:false` is EINVAL since the
 *    CVE-2024-27980 hardening, and refusing shims outright would break every
 *    install/uninstall on Windows) runs through an ABSOLUTE-path
 *    `cmd.exe /d /s /c "<abs shim>" …` with `windowsVerbatimArguments`.
 *    Both branches keep the spawn options at `shell:false` and the spawned
 *    file absolute, so no bare-name search happens anywhere.
 *
 * Resolution is deliberately NOT cached (ruling-approved): installs and
 * watchdog relaunches are human-rate operations, a fresh lookup per call has
 * no stale-PATH surface, and fail-closed stays the simplest path.
 *
 * Pattern source (form only — cross-repo code import is forbidden): zDSH-main
 * `packages/client/workbench/src/git-runner.ts` `defaultBinaryResolver`
 * (where.exe probe + SystemRoot-pinned cwd + absolute-or-null fail-closed)
 * and `pty-registry.ts` `resolveShell` (ComSpec must be win32-absolute,
 * bare/relative values are refused, SystemRoot fallback).
 */
import { accessSync, constants, existsSync } from 'node:fs'
import { join, win32, posix } from 'node:path'

/**
 * Argument allowlist for spawned commands: catalog-controlled values flow
 * into these argv slots, so anything outside this set is refused before a
 * process is created. Deliberately excludes quotes, ampersands, pipes,
 * redirects, carets, percent (cmd env expansion) and bangs (delayed
 * expansion). Space stays allowed because profile directories legitimately
 * contain spaces — the data layer below independently pins owner/repo/version
 * to a much stricter charset.
 *
 * This allowlist is also the safety premise of the win32 verbatim-argument
 * carrier below (quoteForCmd): every cmd.exe metacharacter is excluded, so
 * whitespace wrapping is the only quoting a token can need. The coverage is
 * locked by tests/host/spawn-carrier.spec.ts (metachar-set assertion) to
 * prevent future charset drift from silently invalidating that premise.
 */
const SAFE_ARG = /^[A-Za-z0-9_@+=.,:\\/#\- ]+$/

export function assertSafeArgs(args: readonly string[]): void {
  for (const arg of args) {
    if (!SAFE_ARG.test(arg)) {
      throw new Error(`refusing unsafe command argument: ${JSON.stringify(arg.slice(0, 40))}`)
    }
  }
}

/** A fully planned spawn: absolute file, argv array, shell-free options. */
export interface SpawnInvocation {
  file: string
  args: string[]
  options: { shell: false; windowsHide: true; windowsVerbatimArguments?: true }
}

function isWin32(): boolean {
  return process.platform === 'win32'
}

function isAbsolutePlatform(p: string): boolean {
  return isWin32() ? win32.isAbsolute(p) : posix.isAbsolute(p)
}

/** win32 executable forms worth resolving, best carrier first. */
const WIN_EXECUTABLE_EXTENSIONS = ['.exe', '.cmd', '.bat', '.com'] as const

function firstNonEmptyLine(stdout: string): string | null {
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed !== '') return trimmed
  }
  return null
}

/**
 * Resolve a command name to an absolute, existing, platform-executable path.
 * Bare names go through where.exe/which (probe cwd pinned to SystemRoot on
 * win32); absolute paths are validated in place; anything else (empty,
 * relative, unresolvable, non-executable form) throws with guidance —
 * fail-closed, never a bare-name fallback.
 */
export async function resolveExecutablePath(name: string): Promise<string> {
  const trimmed = name.trim()
  if (trimmed === '') {
    throw new Error('command resolution failed: empty command name is refused (fail-closed)')
  }
  if (isAbsolutePlatform(trimmed)) {
    if (!existsSync(trimmed)) {
      throw new Error(
        `command resolution failed: configured absolute command path does not exist: ${trimmed} (fail-closed, no bare-name fallback)`,
      )
    }
    if (isWin32()) {
      const ext = win32.extname(trimmed).toLowerCase()
      if (!WIN_EXECUTABLE_EXTENSIONS.includes(ext as (typeof WIN_EXECUTABLE_EXTENSIONS)[number])) {
        throw new Error(
          `command resolution failed: ${trimmed} is not a win32 executable form (.exe/.cmd/.bat/.com) — an extensionless file is not executable on Windows (fail-closed)`,
        )
      }
    } else {
      try {
        accessSync(trimmed, constants.X_OK)
      } catch {
        throw new Error(
          `command resolution failed: configured command is not executable (X_OK refused): ${trimmed} (fail-closed)`,
        )
      }
    }
    return trimmed
  }
  if (trimmed.includes('/') || trimmed.includes('\\')) {
    throw new Error(
      `command resolution failed: relative command paths are refused: ${JSON.stringify(trimmed)} (fail-closed — only bare names resolved through PATH or validated absolute paths may spawn)`,
    )
  }
  // Bare name → platform probe. Lazy import keeps this module importable in
  // non-node sandboxes until a spawn is actually planned.
  const { spawnSync } = await import('node:child_process')
  if (isWin32()) {
    let result: { status: number | null; stdout: string; error?: Error }
    try {
      result = spawnSync('where.exe', [trimmed], {
        encoding: 'utf8',
        // `where.exe` searches the current directory before PATH; pin the
        // probe to the neutral system root so a stray binary in the host's
        // cwd can never shadow the PATH lookup (git-runner family form).
        cwd: process.env.SystemRoot ?? process.env.WINDIR ?? undefined,
        windowsHide: true,
      })
    } catch (error) {
      throw new Error(
        `command resolution failed for "${trimmed}": where.exe probe threw (${error instanceof Error ? error.message : String(error)}) — refusing to fall back to the bare name`,
      )
    }
    if (result.error !== undefined) {
      throw new Error(
        `command resolution failed for "${trimmed}": where.exe unavailable (${result.error.message}) — refusing to fall back to the bare name`,
      )
    }
    if (result.status !== 0) {
      throw new Error(
        `command resolution failed for "${trimmed}": where.exe exited ${String(result.status)} (name not found on PATH) — refusing to fall back to the bare name; install the dsh CLI or set launchCommand to an absolute path`,
      )
    }
    // where.exe lists every PATHEXT match; an extensionless echo is a lookup
    // miss, never a usable win32 executable (probe A: spawn → ENOENT). Rank
    // real binaries above shims so a native .exe always wins over a .cmd.
    let best: { path: string; rank: number } | null = null
    for (const line of result.stdout.split(/\r?\n/)) {
      const candidate = line.trim()
      if (candidate === '' || !win32.isAbsolute(candidate)) continue
      const rank = WIN_EXECUTABLE_EXTENSIONS.indexOf(
        win32.extname(candidate).toLowerCase() as (typeof WIN_EXECUTABLE_EXTENSIONS)[number],
      )
      if (rank < 0) continue
      if (best === null || rank < best.rank) best = { path: candidate, rank }
    }
    if (best === null || !existsSync(best.path)) {
      throw new Error(
        `command resolution failed for "${trimmed}": where.exe returned no absolute executable candidate (bare/extensionless echoes are lookup misses) — refusing to fall back to the bare name`,
      )
    }
    return best.path
  }
  let result: { status: number | null; stdout: string; error?: Error }
  try {
    // `command -v` is a shell builtin with no standalone binary; probe
    // through the `which` utility (git-runner family form).
    result = spawnSync('which', [trimmed], { encoding: 'utf8', windowsHide: true })
  } catch (error) {
    throw new Error(
      `command resolution failed for "${trimmed}": which probe threw (${error instanceof Error ? error.message : String(error)}) — refusing to fall back to the bare name`,
    )
  }
  if (result.error !== undefined) {
    throw new Error(
      `command resolution failed for "${trimmed}": which unavailable (${result.error.message}) — refusing to fall back to the bare name`,
    )
  }
  if (result.status !== 0) {
    throw new Error(
      `command resolution failed for "${trimmed}": which exited ${String(result.status)} (name not found on PATH) — refusing to fall back to the bare name; install the dsh CLI or set launchCommand to an absolute path`,
    )
  }
  const resolved = firstNonEmptyLine(result.stdout)
  if (resolved === null || !posix.isAbsolute(resolved) || !existsSync(resolved)) {
    throw new Error(
      `command resolution failed for "${trimmed}": which returned no usable absolute path — refusing to fall back to the bare name`,
    )
  }
  return resolved
}

/**
 * The absolute cmd.exe interpreter for win32 `.cmd`/`.bat` carriers.
 * ComSpec must be an absolute, existing path (pty-registry family judgment);
 * a bare/relative ComSpec would re-enter the very CWD-first search this
 * module exists to eliminate. Fallback: %SystemRoot%\System32\cmd.exe, then
 * the fixed Windows default — each existence-checked, fail-closed otherwise.
 */
export function comSpecAbsolute(): string {
  const comspec = process.env.ComSpec?.trim()
  if (comspec !== undefined && comspec !== '' && win32.isAbsolute(comspec) && existsSync(comspec)) {
    return comspec
  }
  for (const root of [process.env.SystemRoot, process.env.WINDIR]) {
    if (root !== undefined && root !== '' && win32.isAbsolute(root)) {
      const candidate = join(root, 'System32', 'cmd.exe')
      if (existsSync(candidate)) return candidate
    }
  }
  const lastResort = 'C:\\Windows\\System32\\cmd.exe'
  if (existsSync(lastResort)) return lastResort
  throw new Error(
    'command resolution failed: no absolute cmd.exe interpreter available (ComSpec unset/relative/missing and SystemRoot probes failed) — refusing to run a .cmd carrier through a bare interpreter name',
  )
}

/**
 * Quote one token for the verbatim `/d /s /c "<command line>"` carrier.
 * SAFE_ARG has already refused quotes and every cmd.exe metacharacter, so
 * whitespace wrapping is the only quoting a token can need (same shape as
 * Node's own shell:true argument quoter).
 */
function quoteForCmd(token: string): string {
  return token === '' || /[\t ]/.test(token) ? `"${token}"` : token
}

function assertPlanInvariants(plan: SpawnInvocation): SpawnInvocation {
  // Hard lock surface (F1 ruling condition 1): no plan may leave this module
  // with shell !== false or a non-absolute file.
  if (plan.options.shell !== false) {
    throw new Error('internal invariant violated: spawn plan must carry shell:false')
  }
  if (!isAbsolutePlatform(plan.file) || (isWin32() && !win32.isAbsolute(plan.file))) {
    throw new Error(`internal invariant violated: spawn file must be absolute, got ${plan.file}`)
  }
  return plan
}

/**
 * Plan the shell-free spawn for an already-resolved absolute executable.
 * Real executables spawn directly; win32 `.cmd`/`.bat` shims go through the
 * absolute cmd.exe carrier (ruling 1b). Arguments pass the SAFE_ARG gate
 * here as well — the verbatim carrier embeds them in a cmd.exe command line,
 * so the metacharacter exclusion is a hard precondition, not a convention.
 */
export function planSpawnInvocation(absFile: string, args: readonly string[]): SpawnInvocation {
  assertSafeArgs([absFile, ...args])
  if (!isAbsolutePlatform(absFile)) {
    throw new Error(
      `command resolution failed: spawn file must be an absolute path, got ${JSON.stringify(absFile)} (fail-closed)`,
    )
  }
  if (isWin32() && /\.(cmd|bat)$/i.test(absFile)) {
    const interpreter = comSpecAbsolute()
    const commandLine = [absFile, ...args].map(quoteForCmd).join(' ')
    return assertPlanInvariants({
      file: interpreter,
      // /d disables AutoRun, /s keeps the outer-quote stripping semantics
      // stable, /c runs the (fully quoted) command and terminates.
      args: ['/d', '/s', '/c', `"${commandLine}"`],
      options: { shell: false, windowsHide: true, windowsVerbatimArguments: true },
    })
  }
  return assertPlanInvariants({
    file: absFile,
    args: [...args],
    options: { shell: false, windowsHide: true },
  })
}

/**
 * One-call form used by every spawn site in this package: resolve the name
 * (fail-closed) and plan the shell-free carrier. Never spawns a bare name,
 * never sets shell:true, never falls back on resolution failure.
 */
export async function planCommand(name: string, args: readonly string[]): Promise<SpawnInvocation> {
  return planSpawnInvocation(await resolveExecutablePath(name), args)
}
