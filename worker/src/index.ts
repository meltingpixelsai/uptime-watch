// Off-box uptime watch on Cloudflare Workers (Cron Trigger every 2 minutes; wrangler.toml).
//
// Each run probes every site in sites.ts, steps the per-site state (watch.ts), sends ONE Telegram message if anything
// changed (down / still down / recovered), and stores the state in Workers KV. The state is written only when it
// changes, plus a heartbeat at most every 10 minutes, to stay far below the free plan's KV write limit.
//
// GET /status answers the time of the last stored run, so the GitHub probe can page if this Worker stops running.
// Nothing secret is stored or answered: the bot token and chat id are Worker secrets and are never logged.

import { SITES, type Site } from './sites.ts';
import { parseState, render, stepAll, type Probe, type SiteState, type State } from './watch.ts';

interface Env {
  readonly STATE: KVNamespace;
  readonly TELEGRAM_BOT_TOKEN: string;
  readonly TELEGRAM_CHAT_ID: string;
}

interface Stored {
  readonly sites: State;
  /** ISO time of the last stored run. */
  readonly lastTick: string;
  readonly lastProbes: readonly string[];
}

const KEY = 'state';
const HEARTBEAT_MS = 10 * 60_000;
const PROBE_TIMEOUT_MS = 20_000;
const USER_AGENT = 'MeltingPixels-uptime-watch/1.0 (off-box probe; Cloudflare Worker; github.com/meltingpixelsai/uptime-watch)';

async function readStored(env: Env): Promise<Stored | null> {
  let raw: unknown;
  try {
    raw = await env.STATE.get(KEY, 'json');
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  return {
    sites: parseState(r.sites),
    lastTick: typeof r.lastTick === 'string' ? r.lastTick : '',
    lastProbes: Array.isArray(r.lastProbes) ? r.lastProbes.filter((x): x is string => typeof x === 'string') : [],
  };
}

async function probe(site: Site): Promise<Probe> {
  try {
    const res = await fetch(site.url, {
      method: 'GET',
      redirect: 'manual',
      cache: 'no-store',
      headers: { 'user-agent': USER_AGENT },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    await res.body?.cancel();
    return { name: site.name, ok: res.status === 200, code: `HTTP ${res.status}` };
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
    return { name: site.name, ok: false, code: timedOut ? `no answer in ${PROBE_TIMEOUT_MS / 1000} s` : 'connection failed' };
  }
}

async function sendTelegram(env: Env, text: string): Promise<boolean> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(15_000),
    });
    const ok = res.ok;
    await res.body?.cancel();
    if (!ok) console.log(`telegram: HTTP ${res.status}`);
    return ok;
  } catch (err) {
    console.log(`telegram: ${err instanceof Error ? err.name : 'error'}`);
    return false;
  }
}

async function run(env: Env, now: Date): Promise<void> {
  const stored = await readStored(env);
  const prev: State = stored?.sites ?? {};
  const probes = await Promise.all(SITES.map(probe));
  const stepped = stepAll(prev, probes, now);
  const next: Record<string, SiteState> = { ...stepped.next };

  if (stepped.events.length > 0) {
    const downNow = Object.values(next).filter((s) => s.down).length;
    const sent = await sendTelegram(env, render(stepped.events, now, SITES.length, downNow));
    if (!sent) {
      // Keep the previous state of every site that had something to say, so the next run says it again.
      for (const e of stepped.events) {
        const p = prev[e.name];
        if (p) next[e.name] = p;
        else delete next[e.name];
      }
    }
  }

  const lastTickMs = stored?.lastTick ? Date.parse(stored.lastTick) : Number.NaN;
  const changed = JSON.stringify(next) !== JSON.stringify(prev);
  const heartbeatDue = Number.isNaN(lastTickMs) || now.getTime() - lastTickMs >= HEARTBEAT_MS;
  if (changed || heartbeatDue) {
    const record: Stored = {
      sites: next,
      lastTick: now.toISOString(),
      lastProbes: probes.map((p) => `${p.name} ${p.ok ? 'ok' : p.code}`),
    };
    await env.STATE.put(KEY, JSON.stringify(record));
  }
  console.log(probes.map((p) => `${p.name}=${p.ok ? 'ok' : p.code}`).join(' '));
}

export default {
  // Awaited (not waitUntil) so a failed run shows as a failed invocation in the Worker's logs.
  async scheduled(controller: ScheduledController, env: Env): Promise<void> {
    await run(env, new Date(controller.scheduledTime));
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== 'GET' || url.pathname !== '/status') {
      return new Response('Not found\n', { status: 404 });
    }
    const stored = await readStored(env);
    const lastTickMs = stored?.lastTick ? Date.parse(stored.lastTick) : Number.NaN;
    const body = {
      service: 'uptime-watch',
      lastTick: stored?.lastTick || null,
      ageSeconds: Number.isNaN(lastTickMs) ? null : Math.round((Date.now() - lastTickMs) / 1000),
      lastProbes: stored?.lastProbes ?? [],
      down: Object.entries(stored?.sites ?? {})
        .filter(([, s]) => s.down)
        .map(([name, s]) => ({ name, since: s.since ?? null })),
    };
    return new Response(JSON.stringify(body, null, 2), {
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    });
  },
} satisfies ExportedHandler<Env>;
