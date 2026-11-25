import { authed } from '../lib/auth.js';
import { allEvents, allMeasurements } from '../lib/store.js';
import { allMeas, weekStats, dayFood } from '../lib/summary.js';
import { CONFIG, currentPhase, today } from '../lib/config.js';
import { BLOCKS, blockFor } from '../lib/plan.js';
import { ladderProgress, trackSeries, adherence, setsPerMuscle } from '../lib/training.js';
import { dayPlan } from '../lib/adapt.js';
import { loadFlags } from '../lib/load.js';
import { todayTarget, targetNote, estimateMaintenance, baseTarget } from '../lib/diet.js';
import { dayRecovery, recoverySummary, recoveryFlags } from '../lib/recovery.js';

const shift = (date, n) => new Date(new Date(`${date}T12:00:00Z`).getTime() + n * 864e5).toISOString().slice(0, 10);

export default async function handler(req, res) {
  if (!authed(req)) return res.status(401).json({ error: 'send the key in the x-dashboard-key header' });
  const [events, rawMeas] = await Promise.all([allEvents({ debug: req.query.debug === '1' }), allMeasurements()]);
  const meas = allMeas(rawMeas), t = today();
  const tt = todayTarget(events, t);

  // This diet week, Sunday → Saturday.
  const start = shift(t, -new Date(`${t}T12:00:00Z`).getUTCDay());
  const dietWeek = Array.from({ length: 7 }, (_, i) => {
    const d = shift(start, i), f = dayFood(events, d);
    const dt = todayTarget(events, d);
    return { date: d, eaten: f.meals ? f.kcal : null, protein: f.meals ? f.protein : null, target: dt.kcal, type: dt.type, base: dt.base,
      cheat: dt.type === 'feast' || events.some(e => e.type === 'food' && e.cheat && e.date === d) };
  });
  const dietPlan = events.filter(e => e.type === 'diet_plan').sort((a, b) => b.ts - a.ts)[0] || null;
  const lastAdjust = events.filter(e => e.type === 'week_plan').sort((a, b) => b.ts - a.ts)[0] || null;

  res.setHeader('cache-control', 'no-store');
  res.json({
    config: CONFIG,
    phase: currentPhase(),
    measurements: meas,
    events,
    week: weekStats(events, rawMeas, 7),
    fortnight: weekStats(events, rawMeas, 14),
    flags: loadFlags(events, meas),
    diet: { today: { ...tt, note: targetNote(tt) }, week: dietWeek, plan: dietPlan, maintenance: estimateMaintenance(events, meas), cheat: null },
    recovery: {
      days: Array.from({ length: 28 }, (_, i) => { const d = shift(t, i - 27); return { date: d, ...dayRecovery(events, d) }; }),
      summary: recoverySummary(events), flags: recoveryFlags(events)
    },
    training: {
      today: dayPlan(events, t),
      next: Array.from({ length: 7 }, (_, i) => { const d = shift(t, i); const p = dayPlan(events, d); return { date: d, name: p.name, adapted: p.adapted, reason: p.reason }; }),
      lastAdjust: lastAdjust && { summary: lastAdjust.summary, why: lastAdjust.why, date: new Date(lastAdjust.ts).toISOString().slice(0, 10) },
      block: blockFor(),
      blocks: BLOCKS,
      ladders: ladderProgress(events),
      series: trackSeries(events),
      adherence: adherence(events, 28),
      setsPerMuscle: setsPerMuscle(events, 7)
    }
  });
}
