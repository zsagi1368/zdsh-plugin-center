import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FIRST_PARTY_CATALOG_URL, normalizeConfig, resolveDataRoot, type PluginCenterConfig } from '../../src/host/services.js';

/** Minimal valid config carrying only a dataRoot override. */
const configWithDataRoot = (dataRoot: string): PluginCenterConfig => ({
  defaultProfile: 'web',
  mutationsEnabled: false,
  dataRoot,
});

describe('resolveDataRoot', () => {
  it('prefers explicit config.dataRoot over both environment variables', () => {
    // resolve() makes the input platform-absolute (leading "/" alone is
    // drive-rooted on Windows and is returned verbatim by the resolver).
    const explicit = resolve('/explicit/data-root');
    const root = resolveDataRoot(
      configWithDataRoot(explicit),
      { DSH_BRANCH_HOME: '/env/branch-home', DSH_HOME: '/env/dsh-home' },
    );
    expect(root).toBe(explicit);
  });

  it('derives from DSH_BRANCH_HOME when set, winning over DSH_HOME', () => {
    const root = resolveDataRoot(
      undefined,
      { DSH_BRANCH_HOME: '/env/branch-home', DSH_HOME: '/env/dsh-home' },
    );
    expect(root).toBe(join(resolve('/env/branch-home'), 'plugin-center'));
  });

  it('derives from DSH_HOME when DSH_BRANCH_HOME is absent', () => {
    const root = resolveDataRoot(undefined, { DSH_HOME: '/env/dsh-home' });
    expect(root).toBe(join(resolve('/env/dsh-home'), 'zdsh', 'plugin-center'));
  });

  it('falls back to the historical ~/.zdsh-plugin-center when nothing is set', () => {
    const root = resolveDataRoot(undefined, {});
    expect(root).toBe(join(homedir(), '.zdsh-plugin-center'));
  });

  it('skips empty and whitespace-only environment values', () => {
    // blank DSH_BRANCH_HOME falls through to DSH_HOME
    const viaDshHome = resolveDataRoot(
      undefined,
      { DSH_BRANCH_HOME: '   ', DSH_HOME: '/env/dsh-home' },
    );
    expect(viaDshHome).toBe(join(resolve('/env/dsh-home'), 'zdsh', 'plugin-center'));

    // blank DSH_HOME falls through to the historical default
    const fallback = resolveDataRoot(undefined, { DSH_HOME: '' });
    expect(fallback).toBe(join(homedir(), '.zdsh-plugin-center'));
  });

  it('resolves a relative config.dataRoot against the working directory', () => {
    const root = resolveDataRoot(configWithDataRoot('relative/root'), {});
    expect(root).toBe(resolve('relative/root'));
  });
});

describe('catalog source default', () => {
  it('reads the first-party signed registry unless the config opts out', () => {
    // Upstream DSH ships no market index of its own; the first-party registry
    // (catalog plus its published sha256 sidecar) is the live source, and the
    // bundled snapshot stays the offline fallback.
    expect(normalizeConfig({}).remoteCatalogUrl).toBe(FIRST_PARTY_CATALOG_URL);
    expect(normalizeConfig({ remoteCatalogUrl: null }).remoteCatalogUrl).toBeNull();
    expect(normalizeConfig({ remoteCatalogUrl: 'https://example.invalid/c.json' }).remoteCatalogUrl)
      .toBe('https://example.invalid/c.json');
  });
});
