// Diet rebalancing.
// 1) Weekly budget (Sun–Sat, with a cheat-meal reserve held back until used): what you ate over/under on earlier days is spread across the days left. Rules, no API call.
// 2) Weekly review (Sundays, /diet): estimate real maintenance from intake + weight trend, set next week's
//    daily target from the phase goal, and ask Claude for 3 concrete food changes. Stored as a `diet_plan` event.
import { CONFIG, today, currentPhase } from './config.js';
import { dayFood, weekStats } from './summary.js';
import { ask } from './claude.js';
import { DIET } from './schemas.js';
import { addEvent } from './store.js';
import { recoveryFlags, recoverySummary } from './recovery.js';
import { sessionFor, HIGH_DAY_SESSIONS, WEEK, GYM_ORDER, isGymDay } from './plan.js';
import { getProfile, personaPrompt } from './persona.js';

const shift = (date, n) => new Date(new Date(`${date}T12:00:00Z`).getTime() + n * 864e5).toISOString().slice(0, 10);
const weekday = date => new Date(`${date}T12:00:00Z`).getUTCDay(); // Sun = 0 … Sat = 6 (week runs Sunday to Saturday)
const round50 = n => Math.round(n / 50) * 50;

// Base daily target for a date: the latest weekly review covering it, else the phase calories.
export function baseTarget(events, date = today()) {
  const plan = events.filter(e => e.type === 'diet_plan' && date >= e.from && date <= e.to).sort((a, b) => b.ts - a.ts)[0];
  const ph = currentPhase(date);
  if (ph.cycling) return { kcal: ph.kcal, protein: ph.protein, source: 'cycling' };
  return plan?.kcal ? { kcal: plan.kcal, protein: plan.protein_g, source: 'review' } : { kcal: ph.kcal, protein: ph.protein || CONFIG.proteinG, source: 'phase' };
}

// Stop signs (programme): any one adds a high day this week.
export function stopSigns(events) {
  return recoveryFlags(events).filter(f => /^(Sleep|Morning erections|Energy|Resting heart|HRV)/.test(f));
}

const feastDates = (events, from, to) => new Set(events.filter(e => (e.type === 'feast_plan' && e.feast_date >= from && e.feast_date <= to) || (e.type === 'food' && e.cheat && e.date >= from && e.date <= to)).map(e => e.feast_date || e.date));
const gymOn = (events, d) => events.find(e => e.type === 'workout' && e.date === d && GYM_ORDER.includes(e.session))?.session || null;

// Calorie cycling: today's type (low / high / feast) from the session order, planned feasts and the weekly cap.
function cyclingTarget(events, date, ph) {
  // The nightly loop may tune the low/high days and protein (latest `diet_tweak` in 14 days, already bounded).
  const tw = events.filter(e => e.type === 'diet_tweak' && e.ts > Date.now() - 14 * 864e5).sort((a, b) => b.ts - a.ts)[0];
  if (tw) { const low = tw.low || ph.cycling.low, high = tw.high || ph.cycling.high; ph = { ...ph, protein: tw.protein || ph.protein, cycling: { ...ph.cycling, low, high, week: 5 * low + 2 * high } }; }
  const c = ph.cycling, start = shift(date, -weekday(date)), end = shift(start, 6);
  const feasts = feastDates(events, start, end), stops = stopSigns(events);
  const allowed = c.highPerWeek + (stops.length ? 1 : 0);
  const val = t => t === 'feast' ? c.feastCap : t === 'high' ? c.high : c.low;
  // The nightly review may set one day's target from what he actually did (`day_target`, already bounded).
  const mid = (c.low + c.high) / 2;
  const dayOv = d => events.filter(e => e.type === 'day_target' && e.target_date === d).sort((a, b) => b.ts - a.ts)[0] || null;
  let used = 0, expected = 0, highsUsed = 0, logged = 0;
  for (let d = start; d < date; d = shift(d, 1)) {
    const away = events.some(e => e.type === 'workout' && e.date === d && e.place && HIGH_DAY_SESSIONS.includes(e.session));
    const t = feasts.has(d) ? 'feast' : HIGH_DAY_SESSIONS.includes(gymOn(events, d)) && !away ? 'high' : 'low';
    const o = t === 'feast' ? null : dayOv(d)?.kcal ?? null, planned = o ?? val(t);
    if (t === 'feast' || (o != null ? o >= mid : t === 'high')) highsUsed++;
    const f = dayFood(events, d);
    used += f.meals ? f.kcal : planned; expected += planned; if (f.meals) logged++;
  }
  const todayGym = gymOn(events, date) || (isGymDay(events, date) ? sessionFor(date, events).key : null);
  const awayVersion = events.some(e => e.type === 'week_plan' && e.where && (e.days || []).some(d => d.date === date));
  const skippedToday = events.some(e => e.type === 'workout_skip' && e.date === date && HIGH_DAY_SESSIONS.includes(e.session));
  let type = feasts.has(date) ? 'feast' : HIGH_DAY_SESSIONS.includes(todayGym) && !awayVersion && !skippedToday ? 'high' : 'low';
  let reason = type === 'feast' ? 'planned feast' : type === 'high' ? `gym session ${todayGym}` : HIGH_DAY_SESSIONS.includes(todayGym) && awayVersion ? `home version of ${todayGym} is lighter, so it stays a low day` : HIGH_DAY_SESSIONS.includes(todayGym) && skippedToday ? `${todayGym} skipped` : 'low day';
  if (type === 'high' && highsUsed >= allowed) { type = 'low'; reason = `both high days already used this week`; }
  if (type === 'low' && stops.length && todayGym && highsUsed < allowed) { type = 'high'; reason = `stop sign: ${stops[0].split(':')[0].split('(')[0].trim().toLowerCase()}`; }
  // Weekly cap: if the rest of the week can't fit, a (non-feast) high day becomes low.
  const daysLeft = 7 - weekday(date);
  let futureHighs = 0;
  for (let d = shift(date, 1); d <= end; d = shift(d, 1)) if (feasts.has(d) || (isGymDay(events, d) && HIGH_DAY_SESSIONS.includes(sessionFor(d, events).key))) futureHighs++;
  futureHighs = Math.min(futureHighs, Math.max(0, allowed - highsUsed - (type === 'low' ? 0 : 1)));
  const projected = used + val(type) + futureHighs * c.high + (daysLeft - 1 - futureHighs) * c.low;
  if (type === 'high' && projected > c.week + 300) { type = 'low'; reason = `week is over budget, so this day moves to low`; }
  let kcal = val(type);
  const ov = type === 'feast' ? null : dayOv(date);
  if (ov && (ov.kcal <= kcal || projected - kcal + ov.kcal <= c.week + 300)) { kcal = ov.kcal; type = kcal >= mid ? 'high' : 'low'; reason = ov.why || 'set by the nightly review'; }
  return { kcal, protein: ph.protein, fat: type === 'low' ? ph.fat?.low : ph.fat?.high, carbs: type === 'low' ? ph.carbs?.low : ph.carbs?.high, type, reason,
    base: kcal, delta: 0, weekBudget: c.week, weekUsed: used, daysLeft, loggedDays: logged, carried: Math.round(used - expected),
    highsUsed, highsAllowed: allowed, stopSigns: stops, feastToday: type === 'feast', feastCap: c.feastCap, cycling: true,
    projected: Math.round(projected), extraFeasts: Math.max(0, [...feasts].filter(d => d <= date).length - 1) };
}

// Today's target. Cycling phases: low/high/feast day. Flat phases: this week's over/under spread across the days left (base −350/+250).
export function todayTarget(events, date = today()) {
  const ph = currentPhase(date);
  if (ph.cycling) return cyclingTarget(events, date, ph);
  const start = shift(date, -weekday(date));
  const days = Array.from({ length: 7 }, (_, i) => shift(start, i));
  const base = baseTarget(events, date);
  let budget = 0, used = 0, expected = 0, logged = 0;
  for (const d of days) {
    const b = baseTarget(events, d).kcal;
    budget += b;
    if (d < date) { const f = dayFood(events, d); used += f.meals ? f.kcal : b; expected += b; if (f.meals) logged++; }
  }
  const left = 7 - weekday(date);
  const kcal = Math.max(CONFIG.kcalFloor, Math.min(base.kcal + 250, Math.max(base.kcal - 350, round50((budget - used) / left))));
  return { kcal, protein: base.protein, fat: ph.fat?.min, type: 'flat', base: base.kcal, delta: kcal - base.kcal, weekBudget: budget, weekUsed: used, daysLeft: left,
    loggedDays: logged, carried: Math.round(used - expected), cycling: false, extraFeasts: 0 };
}

export function targetNote(t) {
  if (t.cycling) {
    const label = t.type === 'feast' ? `🍖 feast day (cap ${t.feastCap.toLocaleString('en-US')})` : t.type === 'high' ? '🔼 high day' : '🔽 low day';
    const why = t.type === 'low' && t.reason === 'low day' ? '' : `: ${t.reason}`;
    const week = `${t.highsUsed + (t.type === 'low' ? 0 : 1)}/${t.highsAllowed} high days this week`;
    return `${label}${why} · ${week}${t.carried > 200 ? ` · week ${t.carried.toLocaleString('en-US')} kcal over so far` : ''}`;
  }
  if (Math.abs(t.carried) < 100) return '';
  return t.carried > 0
    ? `rebalanced ${t.delta} from ${t.base.toLocaleString('en-US')}: this week is ${t.carried.toLocaleString('en-US')} kcal over, spread over ${t.daysLeft} days`
    : `rebalanced ${t.delta > 0 ? '+' : ''}${t.delta} from ${t.base.toLocaleString('en-US')}: this week is ${Math.abs(t.carried).toLocaleString('en-US')} kcal under`;
}

// Maintenance estimate: average intake on logged days minus the energy in the weight trend (7,700 kcal/kg).
export function estimateMaintenance(events, measurements, days = 21) {
  const from = shift(today(), -(days - 1));
  const food = events.filter(e => e.type === 'food' && e.date >= from);
  const dates = [...new Set(food.map(e => e.date))];
  const w = measurements.filter(m => m.weight && m.date >= from);
  if (dates.length < 10 || w.length < 3) return null;
  const xs = w.map(m => (new Date(m.date) - new Date(from)) / 864e5), ys = w.map(m => m.weight);
  if (Math.max(...xs) - Math.min(...xs) < 10) return null;
  const mx = xs.reduce((a, b) => a + b) / xs.length, my = ys.reduce((a, b) => a + b) / ys.length;
  const slope = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0) / xs.reduce((s, x) => s + (x - mx) ** 2, 0); // kg/day
  const intake = food.reduce((s, e) => s + (e.total?.kcal || 0), 0) / dates.length;
  return { kcal: round50(intake - slope * 7700), intake: Math.round(intake), kgPerWeek: +(slope * 7).toFixed(2), loggedDays: dates.length, weighIns: w.length };
}

export async function dietReview(events, measurements, profile = null) {
  const t = today();
  const phase = currentPhase(t), nextPhase = currentPhase(shift(t, 6));
  const goal = nextPhase.name !== phase.name ? nextPhase : phase;
  const m = estimateMaintenance(events, measurements);
  const rflags = recoveryFlags(events), stops = stopSigns(events);
  const waist = [...measurements].reverse().find(x => x.waist)?.waist ?? null;
  let kcal = null, plan;
  if (goal.cycling) {
    plan = `Calorie cycling: ${goal.cycling.low.toLocaleString('en-US')} on low days, ${goal.cycling.high.toLocaleString('en-US')} on B/D days (${goal.cycling.highPerWeek} a week${stops.length ? ', +1 this week for a stop sign' : ''}), ~${goal.cycling.week.toLocaleString('en-US')}/week`;
  } else {
    // January check: cut only if the waist is above target; otherwise maintenance.
    kcal = goal.kcalIfOnTarget && waist != null && waist <= CONFIG.targets.waist ? goal.kcalIfOnTarget : goal.kcal;
    if (stops.length >= 2) kcal += 200; // programme: warning signs → add ~200 kcal a day
    kcal = Math.max(CONFIG.kcalFloor, kcal);
    plan = `${kcal.toLocaleString('en-US')} kcal/day`;
  }
  const s7 = weekStats(events, measurements, 7), s14 = weekStats(events, measurements, 14);
  const out = await ask({
    system: `${personaPrompt(profile || await getProfile(), events)}
You're writing his weekly diet review. Next week's plan is already decided by the programme (given); explain it in one sentence, tied to how this week went, and give exactly 3 concrete food changes (plain text, no markup) drawn from HIS logged foods, settings and hidden calories (swaps with rough kcal saved or protein added), fitting Egyptian/Levantine eating and the programme (protein through the day, one big dinner, carbs around training, fat floor, fermented foods). summary ≤ 2 sentences. Each recommendation ≤ 20 words. If a stop sign fired, say what it changes.`,
    content: JSON.stringify({ phase: goal, nextWeekPlan: plan, stopSigns: stops, recovery: recoverySummary(events), recoveryFlags: rflags, feastsLast7: events.filter(e => e.type === 'food' && e.cheat && e.date >= shift(t, -7)).length,
      maintenanceEstimate: m || 'not enough data yet', latestWaist: waist, last7: s7, last14: { avgKcal: s14.avgKcal, avgProtein: s14.avgProtein, loggedDays: s14.loggedDays, weights: s14.weightsThisWeek }, bodyTargets: CONFIG.targets }),
    maxTokens: 4000, schema: DIET, effort: 'medium'
  });
  const rec = { from: t, to: shift(t, 6), kcal, plan, protein_g: goal.protein || CONFIG.proteinG, maintenance: m?.kcal ?? null, goal: goal.name, summary: out.summary, recommendations: out.recommendations };
  await addEvent('diet_plan', rec);
  return rec;
}
export function dietMessage(p) {
  return `🍽 <b>Diet for the week</b> (${p.goal})\n\n<b>${p.plan || `${p.kcal.toLocaleString('en-US')} kcal/day`}</b> · ${p.protein_g} g protein${p.maintenance ? ` · estimated maintenance ${p.maintenance.toLocaleString('en-US')}` : ''}\n\n${p.summary}\n\n${p.recommendations.map(r => `• ${r}`).join('\n')}\n\n<i>Planning a feast? Tell me the day ahead ("feast Friday") and it takes one of the high days. /diet re-runs this.</i>`;
}
