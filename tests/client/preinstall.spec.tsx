// @vitest-environment jsdom
/**
 * Factory-preinstall section specs (TC-B3-32C commit #3, DESIGN §8-ADJ-1
 * case B + §8-ADJ-2 case C): seedId-primary-key join over the real 2.1b/
 * 2.2b ledger wire shapes (mount sub-structure included), the three
 * fail-open/fail-safe states, and the standalone-section rendering.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildPreinstallView, loadPreinstallView, type GovernanceRemoteLike } from '../../src/client/preinstall.js';
import { preinstallBadgeLabel, preinstallMountLabel, PreinstallSection } from '../../src/client/index.js';

// ---------------------------------------------------------------- fixtures
// Real shapes from zDSH-main zdsh-factory/seed.json (TC-B1-1.3c first fill:
// core/webstack-verticals; TC-B2-2.1b: core/omnivision; TC-B2-2.2b:
// core/webstack-bridge) and the governance-host PreinstallEntryResult wire
// projection (types.ts §1.4/§9.4), mount sub-structure included.

const ROSTER_PLUGINS = [
  {
    pluginId: 'core/omnivision',
    displayName: 'OmniVision',
    version: '0.1.0-alpha',
    status: 'active',
    source: 'native',
    provenance: 'preinstall',
    approvalRequired: false,
    approved: true,
    warnings: [],
  },
  {
    pluginId: 'core/webstack-bridge',
    displayName: 'WebStack Bridge',
    version: '0.2.0',
    status: 'active',
    source: 'native',
    provenance: 'preinstall',
    approvalRequired: false,
    approved: true,
    warnings: [],
  },
  {
    pluginId: 'core/webstack-verticals',
    displayName: 'WebStack Verticals',
    version: '0.2.0',
    status: 'disabled',
    source: 'native',
    provenance: 'preinstall',
    approvalRequired: false,
    approved: true,
    warnings: [],
  },
  // An operator npm install: must NEVER enter the factory view.
  {
    pluginId: 'user/some-npm-plugin',
    displayName: 'User Install',
    version: '9.9.9',
    status: 'active',
    source: 'native',
    approvalRequired: false,
    approved: true,
    warnings: [],
  },
];

const HEALTHY_REPORT = {
  ranAt: 1_758_050_000_000,
  entries: {
    'core/omnivision': {
      status: 'installed',
      at: 1_758_050_000_000,
      mount: { status: 'mounted', at: 1_758_050_000_000 },
    },
    'core/webstack-bridge': {
      status: 'installed',
      at: 1_758_050_000_000,
      mount: { status: 'mounted', at: 1_758_050_000_000 },
    },
    // The seed declares enabledAtBoot=false → the mount dimension records
    // 'skipped' with the executor's verbatim reason (§9.3/§9.4 verticals case).
    'core/webstack-verticals': {
      status: 'installed',
      at: 1_758_050_000_000,
      mount: {
        status: 'skipped',
        reason: 'not mounted: the seed entry declares enabledAtBoot=false',
        at: 1_758_050_000_000,
      },
    },
  },
};

const ok = (value: unknown) => ({ ok: true, value });

function remoteLike(
  list: GovernanceRemoteLike['list'],
  report: GovernanceRemoteLike['preinstallReport'],
): { pluginGovernance: GovernanceRemoteLike } {
  return { pluginGovernance: { list, preinstallReport: report } };
}

// ---------------------------------------------------------------- join specs

describe('buildPreinstallView (seedId primary-key join, ADJ-1 B)', () => {
  it('joins roster preinstall rows with ledger verdicts and excludes foreign provenance', () => {
    const view = buildPreinstallView(ROSTER_PLUGINS, HEALTHY_REPORT);
    expect(view.ranAt).toBe(1_758_050_000_000);
    expect(view.rows.map(row => row.seedId)).toEqual([
      'core/omnivision',
      'core/webstack-bridge',
      'core/webstack-verticals',
    ]);
    const rowOf = (seedId: string) => {
      const found = view.rows.find(row => row.seedId === seedId);
      if (found === undefined) throw new Error(`missing row ${seedId}`);
      return found;
    };
    expect(rowOf('core/omnivision').badge).toBe('preinstalled');
    expect(rowOf('core/omnivision').mount).toBe('mounted');
    expect(rowOf('core/webstack-bridge').admitted).toBe(true);
    // The verticals row keeps the mount dimension queryable separately from
    // the admission verdict: installed + mount skipped (出厂装好+默认关).
    expect(rowOf('core/webstack-verticals').status).toBe('installed');
    expect(rowOf('core/webstack-verticals').mount).toBe('skipped');
    expect(rowOf('core/webstack-verticals').mountReason).toContain('enabledAtBoot=false');
    expect(rowOf('core/webstack-verticals').badge).toBe('preinstalled');
  });

  it('surfaces a failed ledger row that never entered the roster, with its reason', () => {
    const report = {
      ranAt: 2,
      entries: {
        'core/webstack-bridge': {
          status: 'failed',
          reason: 'file:///…/lib/index.js: invalid plugin',
          at: 2,
        },
      },
    };
    // The bridge admission never landed, so the roster has no preinstall row for it.
    const rosterWithoutBridge = ROSTER_PLUGINS.filter(row => row.pluginId !== 'core/webstack-bridge');
    const view = buildPreinstallView(rosterWithoutBridge, report);
    const row = view.rows.find(entry => entry.seedId === 'core/webstack-bridge');
    expect(row?.badge).toBe('failed');
    expect(row?.reason).toContain('invalid plugin');
    expect(row?.admitted).toBe(false);
  });

  it('the tombstone wins over admission (已被卸载不复活)', () => {
    const report = {
      ranAt: 3,
      entries: {
        'core/webstack-verticals': { status: 'skipped', userUninstalled: true, at: 3 },
      },
    };
    const view = buildPreinstallView(ROSTER_PLUGINS, report);
    const row = view.rows.find(entry => entry.seedId === 'core/webstack-verticals');
    expect(row?.badge).toBe('userUninstalled');
    // Still visible because the roster still holds the preinstall row.
    expect(row?.admitted).toBe(true);
  });

  it('an admitted roster row without a ledger entry renders installed with unknown verdict', () => {
    const view = buildPreinstallView(ROSTER_PLUGINS, { ranAt: null, entries: {} });
    expect(view.rows).toHaveLength(3);
    expect(view.rows.every(row => row.badge === 'preinstalled' && row.status === 'unknown')).toBe(true);
  });

  it('absent or malformed report data degrades to the roster rows alone', () => {
    expect(buildPreinstallView(ROSTER_PLUGINS, null).rows).toHaveLength(3);
    expect(buildPreinstallView(ROSTER_PLUGINS, { ranAt: 'x', entries: 'broken' }).rows).toHaveLength(3);
    expect(buildPreinstallView([], { ranAt: null, entries: {} }).rows).toEqual([]);
  });
});

// ---------------------------------------------------- load + three states

describe('loadPreinstallView fail-safe (ADJ-2 mandatory clause)', () => {
  it('state 1 — normal host: both faces answer, a full view arrives', async () => {
    const warn = vi.fn();
    const view = await loadPreinstallView(
      remoteLike(async () => ok({ plugins: ROSTER_PLUGINS }), async () => ok(HEALTHY_REPORT)),
      warn,
    );
    expect(view?.rows).toHaveLength(3);
    expect(warn).not.toHaveBeenCalled();
  });

  it('state 2 — old host without the preinstallReport face: hidden + silent warn', async () => {
    const warn = vi.fn();
    // A governance remote from before §1.4: list exists, preinstallReport does not.
    const oldHost = { pluginGovernance: { list: async () => ok({ plugins: [] }) } };
    expect(await loadPreinstallView(oldHost, warn)).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('hidden');
    // A remote holder that is entirely absent hides the same way.
    expect(await loadPreinstallView(undefined, warn)).toBeNull();
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('state 3 — a throwing or rejecting fetch hides the whole section, never throws out', async () => {
    const warn = vi.fn();
    const view = await loadPreinstallView(
      remoteLike(
        async () => ok({ plugins: ROSTER_PLUGINS }),
        () => {
          throw new Error('service-not-found: pluginGovernance');
        },
      ),
      warn,
    );
    expect(view).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    // Transport-level rejections (envelope ok:false, e.g. gateway inactive) hide too.
    expect(
      await loadPreinstallView(
        remoteLike(async () => ({ ok: false, error: { code: 'service-not-found', message: 'inactive' } }), async () => ok(HEALTHY_REPORT)),
        warn,
      ),
    ).toBeNull();
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('bare payloads without the transport envelope are accepted structurally', async () => {
    const view = await loadPreinstallView(
      remoteLike(async () => ({ plugins: ROSTER_PLUGINS }), async () => HEALTHY_REPORT),
      () => undefined,
    );
    expect(view?.rows).toHaveLength(3);
  });
});

// ------------------------------------------------------------ rendering

describe('PreinstallSection rendering', () => {
  let container: HTMLDivElement;
  let root: Root;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    warnSpy.mockRestore();
  });

  const flush = async () => {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  };

  it('shows badges and mount states bilingually on a healthy host', async () => {
    await act(async () => {
      root.render(<PreinstallSection locale="zh" remote={remoteLike(async () => ok({ plugins: ROSTER_PLUGINS }), async () => ok(HEALTHY_REPORT))} />);
    });
    await flush();
    const text = container.textContent ?? '';
    expect(text).toContain('出厂组件');
    expect(text).toContain('OmniVision');
    expect(text).toContain('出厂已装');
    expect(text).toContain('已装载');
    expect(text).toContain('出厂未激活');
    // The npm row stayed out of the factory view.
    expect(text).not.toContain('User Install');

    await act(async () => {
      root.render(<PreinstallSection locale="en" remote={remoteLike(async () => ok({ plugins: ROSTER_PLUGINS }), async () => ok(HEALTHY_REPORT))} />);
    });
    await flush();
    const en = container.textContent ?? '';
    expect(en).toContain('Factory components');
    expect(en).toContain('Preinstalled');
    expect(en).toContain('Off at factory');
  });

  it('hides itself entirely on an old host without the report face (no red screen)', async () => {
    await act(async () => {
      root.render(
        <PreinstallSection
          locale="zh"
          remote={{ pluginGovernance: { list: async () => ok({ plugins: [] }) } }} />
      );
    });
    await flush();
    expect(container.innerHTML).toBe('');
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
  });

  it('hides itself when a fetch throws, leaving no rendered error surface', async () => {
    await act(async () => {
      root.render(
        <PreinstallSection
          locale="zh"
          remote={remoteLike(async () => ok({ plugins: ROSTER_PLUGINS }), () => Promise.reject(new Error('gateway inactive')))}
        />
      );
    });
    await flush();
    expect(container.innerHTML).toBe('');
    expect(warnSpy).toHaveBeenCalled();
  });

  it('renders the empty note when the host legitimately has no factory rows', async () => {
    await act(async () => {
      root.render(
        <PreinstallSection locale="zh" remote={remoteLike(async () => ok({ plugins: [] }), async () => ok({ ranAt: null, entries: {} }))} />
      );
    });
    await flush();
    expect(container.textContent ?? '').toContain('当前宿主没有出厂预装组件。');
  });
});

describe('preinstall label helpers', () => {
  it('maps the three badges and four mount states in both locales', () => {
    const row = (badge: string, mount: string, reason: string | null = null) =>
      ({ seedId: 'core/x', displayName: 'X', admitted: true, status: 'installed', reason, userUninstalled: false, mount, mountReason: null, badge }) as never;
    expect(preinstallBadgeLabel(row('preinstalled', 'mounted'), 'zh')).toBe('出厂已装');
    expect(preinstallBadgeLabel(row('failed', 'unknown', 'boom'), 'zh')).toBe('出厂失败');
    expect(preinstallBadgeLabel(row('userUninstalled', 'unknown'), 'zh')).toBe('已被卸载（不会重装）');
    expect(preinstallBadgeLabel(row('failed', 'unknown', 'boom'), 'en')).toBe('Install failed');
    expect(preinstallMountLabel(row('preinstalled', 'mounted'), 'zh')).toBe('已装载');
    expect(preinstallMountLabel(row('preinstalled', 'failed'), 'en')).toBe('Mount failed');
    expect(preinstallMountLabel(row('preinstalled', 'skipped'), 'zh')).toBe('出厂未激活');
    expect(preinstallMountLabel(row('preinstalled', 'unknown'), 'en')).toBe('Mount state unknown');
  });
});
