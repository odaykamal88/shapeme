// "Pushing too hard" flags from logged data. Pure rules, no API call.
import { CONFIG, today } from './config.js';
import { ALL_EXERCISES } from './plan.js';
import { setsOf, setsPerMuscle } from './training.js';
import { recoveryFlags } from './recovery.js';

const day = n => today(new Date(Date.now() - n * 864e5));
const BIG = ['legs', 'back', 'chest', 'shoulders', 'arms'];

function setsByDay(events, date) {
  const out = {};
  events.filter(e => e.type === 'workout' && e.date === date && e.session !== 'morning').forEach(e => (e.exercises || []).forEach(x => {
    const m = x.muscle || ALL_EXERCISES.get(x.plan_id)?.muscle || 'other';
    out[m] = (out[m] || 0) + setsOf(x).length;
  }));
  return out;
}

// training: volume and recovery flags. body: weight-loss speed, under-eating, pain notes.
export function loadFlags(events, measurements = [], { body = true } = {}) {
  const flags = [];
  for (const [m, n] of Object.entries(setsPerMuscle(events, 7)))
    if (BIG.includes(m) && n > 22) flags.push(`${m}: ${n} sets in 7 days (above ~20). Trim 4–6 sets next week.`);

  const days = Array.from({ length: 7 }, (_, i) => day(6 - i));
  const trained = days.filter(d => events.some(e => e.type === 'workout' && e.date === d && e.session !== 'morning'));
  if (trained.length >= 7) flags.push('No rest day in the last 7 days. Take a full rest or easy swim day.');

  for (let i = 1; i < days.length; i++) {
    const a = setsByDay(events, days[i - 1]), b = setsByDay(events, days[i]);
    for (const m of BIG) if ((a[m] || 0) >= 6 && (b[m] || 0) >= 6)
      flags.push(`${m} trained hard on back-to-back days (${days[i - 1].slice(5)}, ${days[i].slice(5)}). Leave ~48 h between.`);
  }

  if (body) {
    const w = measurements.filter(x => x.weight && x.date >= day(14)).sort((x, y) => (x.date < y.date ? -1 : 1));
    if (w.length >= 2) {
      const weeks = Math.max(1, (new Date(w.at(-1).date) - new Date(w[0].date)) / 6048e5);
      const k = Math.min(3, Math.floor(w.length / 2)) || 1;
      const avgW = xs => xs.reduce((t, x) => t + x.weight, 0) / xs.length;
      const rate = (avgW(w.slice(0, k)) - avgW(w.slice(-k))) / weeks;
      if (rate > w[0].weight * 0.01) flags.push(`Weight dropping ${rate.toFixed(1)} kg/week, faster than ~0.7 kg/week. Risks muscle; eat closer to target.`);
    }
    const food = events.filter(e => e.type === 'food' && e.date >= day(6));
    const logged = [...new Set(food.map(e => e.date))];
    if (logged.length >= 3) {
      const avg = food.reduce((s, e) => s + (e.total?.kcal || 0), 0) / logged.length;
      const target = CONFIG.phases.find(p => today() >= p.from && today() <= p.to)?.kcal || CONFIG.maintenanceKcal;
      if (avg < target - 500) flags.push(`Averaging ${Math.round(avg)} kcal vs ${target} target. Under-eating hurts recovery and strength.`);
    }
    events.filter(e => e.type === 'note' && e.date >= day(6) && /pain|hurt|injur|tweak|knee|sore/i.test(e.text || ''))
      .forEach(e => flags.push(`You mentioned "${e.text.slice(0, 60)}" on ${e.date.slice(5)}. Keep pain ≤3/10 and scale that area.`));
  }
  flags.push(...recoveryFlags(events));
  return [...new Set(flags)];
}
