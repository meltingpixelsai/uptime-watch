import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIRM_FAILS, REPAGE_MS, formatEt, parseState, render, stepAll, stepSite, type Probe } from '../src/watch.ts';

const T0 = new Date('2026-11-03T01:20:00Z');
const at = (min: number): Date => new Date(T0.getTime() + min * 60_000);
const fail = (code = 'HTTP 502'): Probe => ({ name: 'noticesent.com', ok: false, code });
const ok: Probe = { name: 'noticesent.com', ok: true, code: 'HTTP 200' };

test('one failed check is not an outage', () => {
  const r = stepSite(undefined, fail(), T0);
  assert.equal(r.event, undefined);
  assert.equal(r.next.down, false);
  assert.equal(r.next.fails, 1);
  assert.equal(r.next.since, T0.toISOString());
});

test(`${CONFIRM_FAILS} failed checks in a row page DOWN once, dated from the first failure`, () => {
  const first = stepSite(undefined, fail(), T0).next;
  const r = stepSite(first, fail('HTTP 503'), at(2));
  assert.equal(r.event?.kind, 'down');
  assert.equal(r.event?.since, T0.toISOString());
  assert.equal(r.event?.code, 'HTTP 503');
  assert.equal(r.next.down, true);
  assert.equal(r.next.lastPage, at(2).toISOString());
});

test('still down: silent until the re-page interval, then STILL DOWN', () => {
  let s = stepSite(undefined, fail(), T0).next;
  s = stepSite(s, fail(), at(2)).next; // DOWN paged at +2
  const quiet = stepSite(s, fail(), at(2 + REPAGE_MS / 60_000 - 2));
  assert.equal(quiet.event, undefined);
  assert.equal(quiet.next.lastPage, at(2).toISOString());
  const again = stepSite(quiet.next, fail(), at(2 + REPAGE_MS / 60_000));
  assert.equal(again.event?.kind, 'still-down');
  assert.equal(again.event?.since, T0.toISOString());
});

test('recovery after an outage pages RECOVERED once and resets', () => {
  let s = stepSite(undefined, fail(), T0).next;
  s = stepSite(s, fail(), at(2)).next;
  const r = stepSite(s, ok, at(6));
  assert.equal(r.event?.kind, 'recovered');
  assert.equal(r.event?.since, T0.toISOString());
  assert.deepEqual(r.next, { fails: 0, down: false });
  assert.equal(stepSite(r.next, ok, at(8)).event, undefined);
});

test('a single blip that recovers pages nothing', () => {
  const s = stepSite(undefined, fail(), T0).next;
  const r = stepSite(s, ok, at(2));
  assert.equal(r.event, undefined);
  assert.deepEqual(r.next, { fails: 0, down: false });
});

test('a down state with no page time pages again (defensive)', () => {
  const r = stepSite({ fails: 5, down: true, since: T0.toISOString() }, fail(), at(4));
  assert.equal(r.event?.kind, 'still-down');
});

test('stepAll steps each probed site and drops sites no longer probed', () => {
  const prev = { 'old.example': { fails: 3, down: true }, 'noticesent.com': { fails: 1, down: false, since: T0.toISOString() } };
  const r = stepAll(prev, [fail(), { name: 'meltpixels.com', ok: true, code: 'HTTP 200' }], at(2));
  assert.deepEqual(Object.keys(r.next).sort(), ['meltpixels.com', 'noticesent.com']);
  assert.equal(r.events.length, 1);
  assert.equal(r.events[0]?.kind, 'down');
});

test('parseState ignores malformed input', () => {
  assert.deepEqual(parseState(null), {});
  assert.deepEqual(parseState([1, 2]), {});
  assert.deepEqual(parseState({ a: { fails: '1', down: true }, b: 7, c: { fails: 2, down: false, since: 9 } }), {
    c: { fails: 2, down: false, since: undefined, lastPage: undefined, lastCode: undefined },
  });
});

test('times render in Eastern time, 12-hour', () => {
  assert.equal(formatEt('2026-11-03T01:22:00Z'), '11/2, 8:22 PM ET');
});

test('render: one message, an all-sites line when every site fails', () => {
  const events = [
    { kind: 'down' as const, name: 'noticesent.com', code: 'HTTP 502', since: T0.toISOString() },
    { kind: 'down' as const, name: 'meltpixels.com', code: 'no answer in 20 s', since: T0.toISOString() },
  ];
  const all = render(events, at(2), 2, 2);
  assert.match(all, /^NOTICESENT\.COM IS DOWN: HTTP 502 on 2 checks in a row \(first failure 11\/2, 8:20 PM ET\)\./);
  assert.match(all, /All 2 sites are failing/);
  const some = render(events.slice(0, 1), at(2), 5, 1);
  assert.doesNotMatch(some, /All \d+ sites/);
  const back = render([{ kind: 'recovered', name: 'noticesent.com', code: 'HTTP 200', since: T0.toISOString() }], at(9), 5, 0);
  assert.match(back, /^noticesent\.com is back up \(it failed from 11\/2, 8:20 PM ET, about 9 min\)\./);
});
