// Training stats derived from logged events and the plan.
import { ALL_EXERCISES, LADDERS, BLOCKS, sessionFor, blockFor, GYM_ORDER, HOME_ORDER, WEEK } from './plan.js';
import { today } from './config.js';

// Accept both the new per-set format and the old {sets, reps, weight_kg} format.
export function setsOf(x) {
  if (Array.isArray(x.sets)) return x.sets;
  const n = Number(x.sets) || 1;
  const seconds = x.seconds != null ? x.seconds : x.minutes != null ? x.minutes * 60 : null;
  return Array.from({ length: n }, () => ({ reps: x.reps ?? null, weight_kg: x.weight_kg ?? null, seconds }));
}

const LADDER_UNIT = Object.fromEntries(LADDERS.map(l => [l.key, l.unit]));

// Which ladder an exercise feeds: harder levels (e.g. advanced tuck, full L-sit) feed their own ladder.
export function trackKey(x) {
  const plan = ALL_EXERCISES.get(x.plan_id);
  return plan?.levelTracks?.[x.level] || plan?.track || null;
}

// Value an exercise contributes to its ladder, or null.
export function trackValue(x) {
  const plan = ALL_EXERCISES.get(x.plan_id);
  const track = trackKey(x);
  if (!track) return null;
  if (track === 'muscle_up' && !x.strict) return null; // only strict reps count
  const sets = setsOf(x);
  const unit = LADDER_UNIT[track];
  if (unit === 'kg') {
    const need = plan.repsTop ? Math.min(plan.repsTop, 5) : 1;
    const ok = sets.filter(s => (s.reps ?? 0) >= need && s.weight_kg != null);
    return ok.length ? Math.max(...ok.map(s => s.weight_kg)) : null;
  }
  if (unit === 's') {
    const v = sets.map(s => s.seconds).filter(v => v != null);
    return v.length ? Math.max(...v) : null;
  }
  const v = sets.map(s => s.reps).filter(v => v != null);
  return v.length ? Math.max(...v) : null;
}

// Best value per track per date, from workouts and direct skill entries.
export function trackSeries(events) {
  const out = {};
  const add = (key, date, value) => {
    if (value == null || Number.isNaN(value)) return;
    out[key] ||= {};
    out[key][date] = Math.max(out[key][date] ?? -Infinity, value);
  };
  for (const e of events) {
    if (e.type === 'workout') for (const x of e.exercises || []) add(trackKey(x), e.date, trackValue(x));
    if (e.type === 'skill') add(e.skill, e.date, Number(e.value));
  }
  return Object.fromEntries(Object.entries(out).map(([k, byDate]) =>
    [k, Object.entries(byDate).sort(([a], [b]) => (a < b ? -1 : 1)).map(([date, value]) => ({ date, value }))]));
}

export function ladderProgress(events) {
  const series = trackSeries(events);
  const prior = events.find(e => e.type === 'bests')?.values || {}; // all-time bests saved by the weekly job
  return LADDERS.map(l => {
    const s = series[l.key] || [];
    const vals = [...s.map(p => p.value), ...(prior[l.key] != null ? [prior[l.key]] : [])];
    const best = vals.length ? Math.max(...vals) : null;
    const pct = l.target && best != null ? Math.max(0, Math.min(1, (best - l.start) / (l.target - l.start || 1))) : null;
    return { ...l, best, last: s.at(-1) || null, pct, done: l.target != null && best != null && best >= l.target };
  });
}

// Most recent logged performance of a plan exercise before a timestamp.
export function lastPerformance(events, planId, beforeTs = Infinity) {
  const hits = events.filter(e => e.type === 'workout' && e.ts < beforeTs)
    .flatMap(e => (e.exercises || []).filter(x => x.plan_id === planId).map(x => ({ ...x, date: e.date, place: e.place || null })));
  // Prefer gym performances: a home variant (lighter load) shouldn't become the gym's "last time".
  return hits.filter(h => !h.place).at(-1) || hits.at(-1) || null;
}

export const fmtSets = x => setsOf(x).map(s =>
  s.seconds != null ? `${s.seconds}s` : `${s.reps ?? '?'}${s.weight_kg != null ? `@${s.weight_kg > 0 ? '+' : ''}${s.weight_kg}` : ''}`).join(', ');

// Progressive-overload nudge: every set hit the top of the rep range → add load.
export function progressionHint(x) {
  const plan = ALL_EXERCISES.get(x.plan_id);
  if (!plan?.repsTop || !plan.inc) return null;
  const sets = setsOf(x);
  if (!sets.length || sets.some(s => (s.reps ?? 0) < plan.repsTop)) return null;
  const w = Math.max(...sets.map(s => s.weight_kg ?? 0));
  return `all sets hit ${plan.repsTop} → next time ${w ? `+${w + plan.inc}` : `add ${plan.inc}`} kg`;
}

const day = n => today(new Date(Date.now() - n * 864e5));

// Last `days` days: gym sessions (A–D), home sessions (H1–H3) and mornings logged.
export function adherence(events, days = 28) {
  const rows = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = day(i);
    const ws = events.filter(e => e.date === date && e.type === 'workout');
    const morning = events.some(e => e.date === date && e.type === 'routine' && e.routine === 'morning') || ws.some(w => w.session === 'morning');
    const gym = ws.find(w => GYM_ORDER.includes(w.session))?.session || null;
    const home = ws.find(w => HOME_ORDER.includes(w.session))?.session || null;
    const other = ws.some(w => !['morning', ...GYM_ORDER, ...HOME_ORDER].includes(w.session));
    rows.push({ date, planned: [gym || (other ? 'class' : ''), home].filter(Boolean).join('+') || '–', block: blockFor(date)?.type || null,
      session: !!(gym || home || other), gym: !!(gym || other), home: !!home, morning });
  }
  const last7 = rows.slice(-7);
  let streak = 0;
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i].morning) streak++;
    else if (i === rows.length - 1) continue;
    else break;
  }
  return {
    calendar: rows,
    sessions7: last7.filter(r => r.gym).length, home7: last7.filter(r => r.home).length,
    mornings7: last7.filter(r => r.morning).length,
    sessions28: rows.filter(r => r.gym).length,
    morningStreak: streak
  };
}

export function setsPerMuscle(events, days = 7) {
  const from = day(days - 1);
  const out = {};
  events.filter(e => e.type === 'workout' && e.date >= from).forEach(e => (e.exercises || []).forEach(x => {
    const m = x.muscle || ALL_EXERCISES.get(x.plan_id)?.muscle || 'other';
    out[m] = (out[m] || 0) + setsOf(x).length;
  }));
  return out;
}

export function planCard(date = today(), events = []) {
  const s = sessionFor(date, events);
  const b = s.block;
  const lines = [`🏋️ <b>${s.name}</b>${b ? ` · ${b.name}` : ''}`];
  if (b?.note) lines.push(`<i>${b.note}</i>`);
  if (b?.type === 'test') lines.push('<i>Test week: run the tests on Mon, Tue and Sat.</i>');
  s.exercises.forEach(e => lines.push(`• ${e.name} — ${e.target}`));
  return lines.join('\n');
}

export { BLOCKS };

// Planned sets for an exercise "done as planned": sets × reps (lower bound) or holds from the target,
// with last time's weight, or a load named in the exercise ("5 kg rucksack", "8 kg club").
export function plannedSets(e, events) {
  const m = String(e.target || '').match(/^(\d+)\s*[×x]\s*(.+)$/);
  const n = m ? Number(m[1]) : 1, rest = m ? m[2] : String(e.target || '');
  const last = e.id || e.plan_id ? lastPerformance(events, e.id || e.plan_id) : null;
  const lastW = last ? setsOf(last).map(s => s.weight_kg).filter(w => w != null) : [];
  const named = String(e.name).match(/(\d+(?:\.\d+)?)\s*kg/i);
  const weight = lastW.length ? Math.max(...lastW) : named ? Number(named[1]) : null;
  const hold = rest.match(/(\d+)(?:–\d+)?\s*s\b/);
  const reps = rest.match(/^(\d+)/);
  return Array.from({ length: n }, () => hold ? { reps: null, weight_kg: null, seconds: Number(hold[1]) }
    : { reps: reps ? Number(reps[1]) : null, weight_kg: weight, seconds: null });
}
