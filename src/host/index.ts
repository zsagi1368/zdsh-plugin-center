/**
 * zdsh-plugin-center — host-side public surface.
 *
 * v1 (standalone plugin) exports the engine building blocks; the Cordis
 * plugin shell and HTTP routes are layered on top of these in the same
 * package (see ./server.js). Everything returned to callers uses the closed
 * CpResult envelope.
 */
export {
  CpErrorCode,
  cpOk,
  cpErr,
  normalizePluginId,
  type CpResult,
  type PlanState,
  type AuditEvent,
  type AuditOutcome,
} from '../shared/types.js';
export { assertSafeUrl, safeFetch, isHostAllowed } from '../shared/ssrc-guard.js';
export { redactRecord, redactValue, isSensitiveValue } from '../shared/redact.js';
export {
  validateCatalogEntry,
  sortEntries,
  paginate,
  searchEntries,
  isValidCommit,
  type CatalogEntry,
  type CandidateEntry,
  type EvidenceLevel,
  type CompatLevel,
} from '../shared/catalog.js';
export { nodePorts, isInsideRoot, type EnginePorts } from './ports.js';
export {
  LifecycleEngine,
  buildInstallCmd,
  buildRemoveCmd,
  buildNpmAddCmd,
  detectLifecycleScripts,
  PROFILE_FILES,
  toCpResult,
  type LifecycleConfig,
  type EngineDeps,
} from './lifecycle-engine.js';
export {
  createPlan,
  confirmationPhrase,
  PlanStore,
  CpError,
  type InstallPlan,
  type PlanAction,
} from './plans.js';
export { loadCatalog, type LoadedCatalog, type CatalogLoadInput } from './snapshot.js';
