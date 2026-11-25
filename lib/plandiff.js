// How a logged day compares with its session plan: missed items, swaps (same muscle) and extras.
// Used by the workout reply (api/telegram.js) and the nightly review (lib/improve.js).
import { SESSIONS } from './plan.js';
import { tokens, similar } from './habits.js';
import { treadmillSteps } from './walk.js';

export const sameExercise = (a, b) => (a.plan_id && (b.plan_id === a.plan_id || b.id === a.plan_id)) || similar(tokens(a.name), tokens(b.name));
const easyCardio = x => treadmillSteps(x) || /walk|ruck|hike/i.test(x.name || '');

export function planDiff(planExercises, done) {
  const items = (planExercises || []).flatMap(e => e.circuit || [e]).map(e => ({ ...e, id: e.id || e.plan_id || null }));
  if (!items.some(p => done.some(x => sameExercise(x, p)))) return null; // a different workout altogether
  const missed = items.filter(p => !done.some(x => sameExercise(x, p)));
  const extras = done.filter(x => !items.some(p => sameExercise(x, p)));
  const swaps = [];
  for (const x of extras) {
    if (easyCardio(x)) continue; // a steady walk never stands in for intervals
    const i = missed.findIndex(p => p.muscle && p.muscle === x.muscle && !p.track && !p.levelTracks); // skills (tracked holds) can't be swapped
    if (i >= 0) swaps.push([missed.splice(i, 1)[0].name, x.name]);
  }
  return { missed: missed.map(p => p.name), swaps, added: extras.filter(x => !swaps.some(w => w[1] === x.name)).map(x => x.name) };
}

// The plan a past session was meant to follow: that day's rebuilt plan with the same letter, else the programme.
export function sessionPlanOn(events, date, key) {
  const wp = events.filter(e => e.type === 'week_plan').sort((a, b) => b.ts - a.ts)
    .map(p => (p.days || []).find(d => d.date === date && (d.key || p.key) === key)).find(Boolean);
  return wp ? wp.exercises : SESSIONS[key]?.exercises || null;
}

// One line per trained day: what was missed / swapped / added versus that day's plan.
export function daysVsPlan(events, since) {
  const byDay = new Map();
  for (const e of events) if (e.type === 'workout' && e.date >= since && e.session && e.session !== 'morning') {
    const k = `${e.date}|${e.session}`; byDay.set(k, [...(byDay.get(k) || []), ...(e.exercises || [])]);
  }
  return [...byDay].map(([k, done]) => {
    const [date, key] = k.split('|'), d = planDiff(sessionPlanOn(events, date, key), done);
    return d && (d.missed.length || d.swaps.length || d.added.length) ? { date, session: key, ...d } : null;
  }).filter(Boolean);
}
