import { join } from 'node:path';
import type { AuditEvent } from '../shared/types.js';
import type { CatalogEntry as Entry } from '../shared/catalog.js';
import { CpErrorCode, cpErr, cpOk, type CpResult, type PlanState } from '../shared/types.js';
import { redactRecord } from '../shared/redact.js';
import {
  confirmationPhrase,
  CpError,
  createPlan,
  PlanStore,
  type InstallPlan,
  type PlanAction,
} from './plans.js';
import type { EnginePorts } from './ports.js';

/** The three profile files an install touches; the truth lives here. */
export const PROFILE_FILES = ['package.json', 'pnpm-workspace.yaml', 'cordis.patch.yml'] as const;

const LIFECYCLE_SCRIPT_KEYS = [
  'preinstall',
  'install',
  'postinstall',
  'prepublish',
  'prepare',
] as const;

export interface LifecycleConfig {
  /** Root for backups / audit log / snapshot cache. */
  dataRoot: string;
  /** Entries like `pkg:postinstall` whose lifecycle scripts may run. Empty by default. */
  scriptAllowlist?: string[];
}

/** Optional post-install probe; throwing or rejecting fails the plan. */
export type HealthProbe = () => Promise<void>;

export interface EngineDeps {
  ports: EnginePorts;
  config: LifecycleConfig;
  healthProbe?: HealthProbe;
  auditSink?: (line: string) => void;
}

/** Pure command builders so tests can pin exact shapes without spawning. */
export function buildInstallCmd(
  profile: string,
  owner: string,
  repo: string,
  commit: string,
): { cmd: string; args: string[] } {
  return {
    cmd: 'dsh',
    args: [
      'plugin',
      '--profile',
      profile,
      'add',
      `git+https://github.com/${owner}/${repo}.git#${commit}`,
    ],
  };
}

export function buildNpmAddCmd(profile: string, pkgName: string, version: string): { cmd: string; args: string[] } {
  return { cmd: 'dsh', args: ['plugin', '--profile', profile, 'add', `${pkgName}@${version}`] };
}

export function buildRemoveCmd(profile: string, pkgName: string): { cmd: string; args: string[] } {
  return { cmd: 'dsh', args: ['plugin', '--profile', profile, 'remove', pkgName] };
}

/** List lifecycle scripts a package manifest would run on install. */
export function detectLifecycleScripts(manifest: Record<string, unknown>): string[] {
  const scripts = manifest.scripts;
  if (typeof scripts !== 'object' || scripts === null) return [];
  const found: string[] = [];
  for (const key of LIFECYCLE_SCRIPT_KEYS) {
    const value = (scripts as Record<string, unknown>)[key];
    if (typeof value === 'string' && value.trim()) found.push(key);
  }
  return found;
}

interface FileSnapshot {
  path: string;
  hash: string | null;
}

interface BackupRecord {
  dir: string;
  pairs: Array<{ backupPath: string; originalPath: string }>;
}

export class LifecycleEngine {
  private readonly plans = new PlanStore();
  private readonly states = new Map<string, PlanState>();

  constructor(private readonly deps: EngineDeps) {}

  private get fs() {
    return this.deps.ports.fs;
  }

  stateOf(planId: string): PlanState {
    return this.states.get(planId) ?? 'draft';
  }

  /**
   * Build and register a plan. `targetManifest` (when the registry supplied
   * the package manifest) runs the lifecycle-script gate before staging.
   */
  buildPlan(
    entry: Entry,
    action: PlanAction,
    profile: string,
    targetManifest?: Record<string, unknown>,
  ): CpResult<{ plan: InstallPlan; phrase: string }> {
    try {
      if (action !== 'uninstall' && targetManifest) {
        const scripts = detectLifecycleScripts(targetManifest);
        const allow = this.deps.config.scriptAllowlist ?? [];
        const pkgName = entry.packageName ?? entry.id;
        const blocked = scripts.filter((s) => !allow.includes(`${pkgName}:${s}`));
        if (blocked.length > 0) {
          return cpErr(
            'script_blocked',
            `entry declares lifecycle scripts (${blocked.join(', ')}) not on the allowlist`,
          );
        }
      }
      const plan = createPlan(entry, action, profile);
      this.plans.add(plan);
      this.states.set(plan.planId, 'planned');
      this.audit({
        ts: this.now(),
        action: 'plan.create',
        planId: plan.planId,
        step: 'planned',
        outcome: 'ok',
      });
      return cpOk({ plan, phrase: confirmationPhrase(plan) });
    } catch (error) {
      return toCpResult(error);
    }
  }

  /** One-shot confirmation bound to the deterministic phrase. */
  confirmPlan(planId: string, phrase: string): CpResult<InstallPlan> {
    try {
      const plan = this.plans.confirm(planId, phrase);
      this.audit({
        ts: this.now(),
        action: 'plan.confirm',
        planId,
        step: 'confirmed',
        outcome: 'ok',
      });
      return cpOk(plan);
    } catch (error) {
      return toCpResult(error);
    }
  }

  /**
   * Apply a confirmed plan: pre-hash the profile, back it up, run the pinned
   * official CLI, compare post-state, probe health, audit everything — with
   * byte-exact rollback on any failure after the backup succeeded.
   */
  async applyPlan(planId: string): Promise<CpResult<{ state: PlanState }>> {
    const record = this.plans.get(planId);
    if (!record || record.state !== 'confirmed') {
      return cpErr('invalid_plan', `plan ${planId} is not in confirmed state`);
    }
    const plan = record.plan;
    this.states.set(planId, 'executing');
    let backup: BackupRecord | null = null;
    try {
      const before = this.snapshotProfile(plan.profile);

      // backup every existing profile file
      const dir = join(this.deps.config.dataRoot, 'backups', `${Date.now()}-${plan.action}`);
      this.fs.mkdirDeep(dir);
      const pairs: BackupRecord['pairs'] = [];
      for (const snap of before) {
        if (snap.hash !== null) {
          const backupPath = join(dir, baseNameOf(snap.path));
          this.fs.copyFile(snap.path, backupPath);
          pairs.push({ backupPath, originalPath: snap.path });
        }
      }
      backup = { dir, pairs };
      this.audit({
        ts: this.now(),
        action: 'plan.execute',
        planId,
        step: 'backup',
        outcome: 'ok',
      });

      // run the pinned official CLI (never --force on add)
      const spec = this.commandFor(plan);
      if (spec.args.includes('add') && spec.args.includes('--force')) {
        throw new CpError(CpErrorCode.installFailed, 'force-add is forbidden');
      }
      const outcome = await this.deps.ports.commands.run(spec);
      if (outcome.code !== 0) {
        throw new CpError(
          CpErrorCode.installFailed,
          `dsh exited ${outcome.code}: ${outcome.stderr.slice(0, 400)}`,
        );
      }
      this.audit({
        ts: this.now(),
        action: 'plan.execute',
        planId,
        step: 'command',
        outcome: 'ok',
      });

      // post-state comparison (audit only; rollback is hash-driven on failure)
      const changed = before
        .filter((snap) => this.fs.hashFile(snap.path) !== snap.hash)
        .map((s) => baseNameOf(s.path));
      this.audit({
        ts: this.now(),
        action: 'plan.execute',
        planId,
        step: 'post-hash',
        outcome: 'ok',
        detail: { changedFiles: changed.join(',') },
      });

      // health probe (a rejecting probe maps to health_check_failed)
      if (this.deps.healthProbe) {
        try {
          await this.deps.healthProbe();
        } catch (error) {
          throw new CpError(
            CpErrorCode.healthCheckFailed,
            error instanceof Error ? error.message : String(error),
          );
        }
      }
      this.audit({
        ts: this.now(),
        action: 'plan.execute',
        planId,
        step: 'health',
        outcome: 'ok',
      });

      this.states.set(planId, 'restart-pending');
      this.audit({
        ts: this.now(),
        action: 'plan.done',
        planId,
        step: 'restart-pending',
        outcome: 'ok',
      });
      return cpOk({ state: 'restart-pending' });
    } catch (error) {
      const code = error instanceof CpError ? error.code : CpErrorCode.internal;
      const rolledBack = backup ? this.rollbackFromBackup(backup) : true;
      this.states.set(planId, rolledBack ? 'rolled-back' : 'executing');
      this.audit({
        ts: this.now(),
        action: 'plan.failed',
        planId,
        step: 'rollback',
        outcome: rolledBack ? 'rolled-back' : 'error',
        errorCode: String(code),
      });
      if (backup && !rolledBack) {
        return cpErr(
          'rollback_failed',
          `execution failed (${String(code)}) and rollback could not be verified`,
        );
      }
      return toCpResult(error);
    }
  }

  private commandFor(plan: InstallPlan): { cmd: string; args: string[] } {
    if (plan.action === 'uninstall') {
      return buildRemoveCmd(plan.profile, plan.entry.packageName ?? plan.entry.id);
    }
    if (plan.entry.source === 'github') {
      return buildInstallCmd(
        plan.profile,
        plan.entry.owner as string,
        plan.entry.repo as string,
        plan.entry.pinnedCommit as string,
      );
    }
    return buildNpmAddCmd(plan.profile, plan.entry.packageName as string, plan.entry.version as string);
  }

  /** Restore each backed-up file to its original path and verify bytes. */
  private rollbackFromBackup(backup: BackupRecord): boolean {
    for (const pair of backup.pairs) {
      const contents = this.fs.readFile(pair.backupPath);
      if (contents === null) return false;
      const expected = this.fs.hashFile(pair.backupPath);
      try {
        this.fs.writeFileAtomic(pair.originalPath, contents);
      } catch {
        return false;
      }
      if (!expected || this.fs.hashFile(pair.originalPath) !== expected) return false;
    }
    return true;
  }

  private snapshotProfile(profileDir: string): FileSnapshot[] {
    const snapshots: FileSnapshot[] = [];
    for (const name of PROFILE_FILES) {
      const path = join(profileDir, name);
      snapshots.push({ path, hash: this.fs.hashFile(path) });
    }
    return snapshots;
  }

  private now(): string {
    return this.deps.ports.clock.now().toISOString();
  }

  private audit(event: AuditEvent): void {
    const line = JSON.stringify(redactRecord({ ...event }));
    if (this.deps.auditSink) {
      this.deps.auditSink(line);
      return;
    }
    const logPath = join(this.deps.config.dataRoot, 'audit-log.jsonl');
    const existing = this.fs.readFile(logPath) ?? '';
    const separator = existing === '' || existing.endsWith('\n') ? '' : '\n';
    this.fs.writeFileAtomic(logPath, `${existing}${separator}${line}\n`);
  }
}

function baseNameOf(p: string): string {
  const idx = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return idx === -1 ? p : p.slice(idx + 1);
}

export function toCpResult<T>(error: unknown): CpResult<T> {
  if (error instanceof CpError) {
    return cpErr(error.code, error.message);
  }
  return cpErr('internal', error instanceof Error ? error.message : String(error));
}
