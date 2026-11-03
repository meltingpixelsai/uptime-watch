// Pure decision logic for the off-box watch: no network, no storage, so it can be unit-tested.
//
// Per site, each scheduled check produces a Probe. A site is paged as DOWN only after CONFIRM_FAILS failed checks in
// a row (the same retry-confirm idea as the GitHub probe: one bad answer is not an outage). While it stays down it is
// paged again every REPAGE_MS, so a long outage keeps being visible without paging every check. When it answers again
// a RECOVERED message goes out once.

export const CONFIRM_FAILS = 2;
export const REPAGE_MS = 30 * 60_000;

export interface Probe {
  readonly name: string;
  readonly ok: boolean;
  /** HTTP status as text, or "timeout" / "no answer". */
  readonly code: string;
}

export interface SiteState {
  readonly fails: number;
  readonly down: boolean;
  /** ISO time of the first failed check of the current failure run. */
  readonly since?: string;
  /** ISO time the last DOWN / STILL DOWN page went out. */
  readonly lastPage?: string;
  readonly lastCode?: string;
}

export type State = Readonly<Record<string, SiteState>>;

export type EventKind = 'down' | 'still-down' | 'recovered';

export interface WatchEvent {
  readonly kind: EventKind;
  readonly name: string;
  readonly code: string;
  readonly since: string;
}

const UP: SiteState = { fails: 0, down: false };

export function stepSite(prev: SiteState | undefined, probe: Probe, now: Date): { next: SiteState; event?: WatchEvent } {
  const nowIso = now.toISOString();
  if (probe.ok) {
    if (prev?.down) {
      return { next: UP, event: { kind: 'recovered', name: probe.name, code: probe.code, since: prev.since ?? nowIso } };
    }
    return { next: UP };
  }
  const fails = (prev?.fails ?? 0) + 1;
  const since = prev?.since ?? nowIso;
  if (!prev?.down) {
    if (fails >= CONFIRM_FAILS) {
      return {
        next: { fails, down: true, since, lastPage: nowIso, lastCode: probe.code },
        event: { kind: 'down', name: probe.name, code: probe.code, since },
      };
    }
    return { next: { fails, down: false, since, lastCode: probe.code } };
  }
  const lastPageMs = prev.lastPage ? Date.parse(prev.lastPage) : Number.NaN;
  if (Number.isNaN(lastPageMs) || now.getTime() - lastPageMs >= REPAGE_MS) {
    return {
      next: { fails, down: true, since, lastPage: nowIso, lastCode: probe.code },
      event: { kind: 'still-down', name: probe.name, code: probe.code, since },
    };
  }
  return { next: { fails, down: true, since, lastPage: prev.lastPage, lastCode: probe.code } };
}

/** Steps every probed site. Sites that are no longer probed drop out of the state. */
export function stepAll(prev: State, probes: readonly Probe[], now: Date): { next: State; events: WatchEvent[] } {
  const next: Record<string, SiteState> = {};
  const events: WatchEvent[] = [];
  for (const probe of probes) {
    const r = stepSite(prev[probe.name], probe, now);
    next[probe.name] = r.next;
    if (r.event) events.push(r.event);
  }
  return { next, events };
}

/** Reads a stored state defensively: anything malformed counts as "no history". */
export function parseState(raw: unknown): State {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const out: Record<string, SiteState> = {};
  for (const [name, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v !== 'object' || v === null) continue;
    const s = v as Record<string, unknown>;
    if (typeof s.fails !== 'number' || typeof s.down !== 'boolean') continue;
    out[name] = {
      fails: s.fails,
      down: s.down,
      since: typeof s.since === 'string' ? s.since : undefined,
      lastPage: typeof s.lastPage === 'string' ? s.lastPage : undefined,
      lastCode: typeof s.lastCode === 'string' ? s.lastCode : undefined,
    };
  }
  return out;
}

const ET = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

/** "11/2, 8:22 PM ET" */
export function formatEt(iso: string): string {
  return `${ET.format(new Date(iso))} ET`;
}

function minutesBetween(fromIso: string, to: Date): number {
  return Math.max(0, Math.round((to.getTime() - Date.parse(fromIso)) / 60_000));
}

/** One Telegram message for every event of a check. */
export function render(events: readonly WatchEvent[], now: Date, siteCount: number, downNow: number): string {
  const lines: string[] = [];
  for (const e of events) {
    const site = e.name.toUpperCase();
    if (e.kind === 'down') {
      lines.push(`${site} IS DOWN: ${e.code} on ${CONFIRM_FAILS} checks in a row (first failure ${formatEt(e.since)}).`);
    } else if (e.kind === 'still-down') {
      lines.push(`${site} STILL DOWN since ${formatEt(e.since)} (${minutesBetween(e.since, now)} min; now ${e.code}).`);
    } else {
      lines.push(`${e.name} is back up (it failed from ${formatEt(e.since)}, about ${minutesBetween(e.since, now)} min).`);
    }
  }
  if (siteCount > 1 && downNow === siteCount) {
    lines.push(`All ${siteCount} sites are failing: the server itself may be down or unreachable.`);
  }
  lines.push('Off-box watch (Cloudflare Worker, checks every 2 min).');
  return lines.join('\n');
}
