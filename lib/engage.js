// Engagement that earns its place: commit to the week, one-tap usual meals, the ski countdown,
// the gap to the next milestone, and a same-day calorie correction. Pure rules, no API calls.
import { today, CONFIG } from './config.js';
import { tokens, similar } from './habits.js';
import { LADDERS, isGymDay, commitFor, eventOn } from './plan.js';
import { trackKey, trackValue } from './training.js';

const shift = (d, n) => new Date(new Date(`${d}T12:00:00Z`).getTime() + n * 864e5).toISOString().slice(0, 10);
const weekday = d => new Date(`${d}T12:00:00Z`).getUTCDay();
const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const fmt = n => Math.round(n).toLocaleString('en-US');

// ---- Week commit (Saturday recap → the coming Sun–Sat; /week → the rest of this week)
export const weekStart = d => shift(d, -weekday(d));
export function commitDraft(events, start, from = start) {
  const days = Array.from({ length: 7 }, (_, i) => shift(start, i)).filter(d => d >= from);
  return { week_start: start, from, days: days.filter(d => isGymDay(events, d)) };
}
export function commitButtons(draft) {
  const all = Array.from({ length: 7 }, (_, i) => shift(draft.week_start, i)).filter(d => d >= draft.from);
  const btn = d => ({ text: `${draft.days.includes(d) ? '✅ ' : ''}${DAY[weekday(d)]}`, callback_data: `k:${d}` });
  const rows = [];
  for (let i = 0; i < all.length; i += 4) rows.push(all.slice(i, i + 4).map(btn));
  rows.push([{ text: `🔒 Lock in ${draft.days.length} gym day${draft.days.length === 1 ? '' : 's'}`, callback_data: 'k:ok' }]);
  return { inline_keyboard: rows };
}
export const commitText = (draft, locked = false) => locked
  ? `🔒 <b>Locked:</b> ${draft.days.map(d => DAY[weekday(d)]).join(', ') || 'no gym days'}. Sessions, high-calorie days and reminders follow your picks.`
  : `🗓 <b>Which days are gym days${draft.from > draft.week_start ? ' for the rest of this week' : ' this week'}?</b> Tap to change, then lock it in.`;

// ---- Usual meals: the same meal (similar items, same slot) on 2+ of the last 14 days, not yet logged today.
export function usualMeals(events, max = 2) {
  const t = today(), from = shift(t, -14);
  const food = events.filter(e => e.type === 'food' && e.date >= from && e.date < t && !e.cheat && e.items?.length && e.total);
  const loggedToday = new Set(events.filter(e => e.type === 'food' && e.date === t).map(e => e.meal));
  const out = [];
  for (const slot of ['breakfast', 'lunch', 'dinner', 'shake', 'snack']) {
    if (loggedToday.has(slot)) continue;
    const meals = food.filter(e => e.meal === slot).sort((a, b) => b.ts - a.ts);
    const tok = e => tokens(e.items.map(i => i.name).join(' '));
    const pick = meals.find(m => meals.some(o => o.date !== m.date && similar(tok(m), tok(o))));
    if (pick) out.push({ ts: pick.ts, slot, kcal: pick.total.kcal, label: `${slot[0].toUpperCase()}${slot.slice(1)}` });
  }
  return out.slice(0, max);
}
export const usualButtons = meals => meals.length ? { inline_keyboard: [meals.map(m => ({ text: `🔁 Usual ${m.label.toLowerCase()} (~${fmt(m.kcal)})`, callback_data: `q:${m.ts}` }))] } : undefined;

// ---- Ski countdown + leg sessions this week (B and H2 hit the legs).
export function countdownLine(events, t = today()) {
  const ski = CONFIG.phases.find(p => /ski/i.test(p.name));
  if (!ski) return null;
  const n = Math.round((new Date(`${ski.from}T12:00:00Z`) - new Date(`${t}T12:00:00Z`)) / 864e5);
  if (n < 1 || n > 60) return null;
  const ws = weekStart(t);
  const legs = new Set(events.filter(e => e.type === 'workout' && e.date >= ws && e.date <= t && ['B', 'H2'].includes(e.session)).map(e => `${e.date}${e.session}`)).size;
  return `🎿 ${n} day${n === 1 ? '' : 's'} to the slopes · legs this week ${legs}/2`;
}

// ---- Gap to the next milestone for what was just logged (the closest one wins).
export function milestoneGap(exercises, bests = {}) {
  let best = null;
  for (const x of exercises) {
    const k = trackKey(x), v = trackValue(x), l = LADDERS.find(l => l.key === k);
    if (!l || l.target == null || v == null) continue;
    const top = Math.max(v, bests[k] ?? -Infinity);
    if (top >= l.target) continue;
    const ratio = top / l.target;
    if (!best || ratio > best.ratio) best = { ratio, l, top };
  }
  if (!best) return null;
  const u = best.l.unit === 'kg' ? ' kg' : best.l.unit === 's' ? ' s' : ' reps';
  const gap = Math.round((best.l.target - best.top) * 10) / 10;
  return `🎯 ${best.l.name}: ${best.top}${u} → target ${best.l.target}${u}, ${gap}${u} to go`;
}

// ---- Same-day calorie correction: a high day whose fuel work (legs, intervals) was skipped earns less.
// Done = 1, swapped = 0.5, missed = 0; legs and cardio count double. Only ever lowers, only today.
export function sameDayKcal(tt, plan, vsPlan, low = 1500) {
  if (!tt?.cycling || tt.type !== 'high' || !plan || !vsPlan) return null;
  const items = plan.exercises.flatMap(e => e.circuit || [e]);
  const w = p => ['legs', 'cardio'].includes(p.muscle) ? 2 : 1;
  const score = p => vsPlan.missed.includes(p.name) ? 0 : vsPlan.swaps.some(s => s[0] === p.name) ? 0.5 : 1;
  const total = items.reduce((n, p) => n + w(p), 0), got = items.reduce((n, p) => n + w(p) * score(p), 0);
  const f = total ? got / total : 1;
  if (f >= 0.8) return null;
  const kcal = Math.round((low + (tt.kcal - low) * f) / 50) * 50;
  if (kcal >= tt.kcal) return null;
  const skipped = vsPlan.missed.filter(n => items.some(p => p.name === n && ['legs', 'cardio'].includes(p.muscle)));
  return { kcal, why: `${skipped.length ? `skipped ${skipped.map(n => n.replace(/\s*\(.*\)$/, '').toLowerCase()).join(' and ')}` : 'lighter session than planned'}, so less fuel needed` };
}

// ---- Never miss twice: yesterday was a gym day and nothing was logged or skipped.
export function slipLine(events, t = today()) {
  const y = shift(t, -1);
  if (eventOn(events, y) || eventOn(events, t)) return null; // an event is never a slip
  if (!isGymDay(events, y)) return null;
  if (events.some(e => (e.type === 'workout' || e.type === 'workout_skip') && e.date === y && /^[ABCD]$/.test(e.session || ''))) return null;
  return isGymDay(events, t) ? 'Yesterday slipped, no drama. Never miss twice: today counts, even a 20-minute version.'
    : 'Yesterday slipped, no drama. Never miss twice: a 20-minute home session or a long walk counts today.';
}

// Event mode line for the Today card.
export function eventLine(events, t = today()) {
  const e = eventOn(events, t);
  return e ? `🎉 ${e.label}: enjoy it. Minimums: protein at one meal, water between drinks, a walk.` : null;
}

export { commitFor, DAY };
