// Recovery signals: sleep, morning erections, energy, knee pain (bot) + resting HR and HRV (Health Auto Export).
// Several sources per day are merged; latest non-null value wins. Pure rules, no API call.
import { today } from './config.js';

const day = n => today(new Date(Date.now() - n * 864e5));
const FIELDS = ['sleep_h', 'wood', 'energy', 'knee', 'rhr', 'hrv', 'bloat'];
const avg = xs => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
const median = xs => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

export function dayRecovery(events, date) {
  const out = {};
  events.filter(e => e.type === 'recovery' && e.date === date).sort((a, b) => a.ts - b.ts)
    .forEach(e => FIELDS.forEach(f => { if (e[f] != null) out[f] = e[f]; }));
  return out;
}

const series = (events, field, from, to) => {
  const out = [];
  for (let i = from; i >= to; i--) { const v = dayRecovery(events, day(i))[field]; if (v != null) out.push(v); }
  return out;
};

export function recoverySummary(events) {
  const w = series(events, 'wood', 6, 0), wPrev = series(events, 'wood', 27, 7);
  const rhr = series(events, 'rhr', 2, 0), rhrBase = series(events, 'rhr', 30, 3);
  const hrv = series(events, 'hrv', 2, 0), hrvBase = series(events, 'hrv', 30, 3);
  const r1 = x => x == null ? null : Math.round(x * 10) / 10;
  return {
    sleepAvg7: r1(avg(series(events, 'sleep_h', 6, 0))), sleepNights: series(events, 'sleep_h', 6, 0).length,
    woodRate7: w.length ? r1(w.filter(Boolean).length / w.length) : null, woodDays: w.length,
    woodRatePrev: wPrev.length >= 5 ? r1(wPrev.filter(Boolean).length / wPrev.length) : null,
    energyAvg7: r1(avg(series(events, 'energy', 6, 0))), kneeMax7: series(events, 'knee', 6, 0).reduce((m, x) => Math.max(m, x), 0) || null,
    rhr3: r1(avg(rhr)), rhrBase: rhrBase.length >= 7 ? median(rhrBase) : null,
    hrv3: r1(avg(hrv)), hrvBase: hrvBase.length >= 7 ? median(hrvBase) : null
  };
}

export function recoveryFlags(events) {
  const s = recoverySummary(events), f = [];
  if (s.sleepNights >= 3 && s.sleepAvg7 < 6.5) f.push(`Sleep averaging ${s.sleepAvg7} h (aim for 7.5+). Short sleep on a cut costs muscle, not fat.`);
  if (s.woodDays >= 4 && s.woodRate7 < 0.5 && (s.woodRatePrev == null || s.woodRatePrev - s.woodRate7 >= 0.25))
    f.push(`Morning erections on ${Math.round(s.woodRate7 * 100)}% of days${s.woodRatePrev != null ? ` (was ${Math.round(s.woodRatePrev * 100)}%)` : ''}: an early sign of too big a deficit or poor recovery.`);
  if (s.energyAvg7 != null && s.energyAvg7 <= 2.5) f.push(`Energy averaging ${s.energyAvg7}/5 this week.`);
  if (s.kneeMax7 > 3) f.push(`Knee pain hit ${s.kneeMax7}/10 this week (rule: ≤3). Scale lunges, jumps and deep knee work.`);
  if (s.rhr3 != null && s.rhrBase != null && s.rhr3 >= s.rhrBase + 5) f.push(`Resting heart rate ${s.rhr3} vs your usual ${s.rhrBase} bpm: accumulated fatigue.`);
  if (s.hrv3 != null && s.hrvBase != null && s.hrv3 < s.hrvBase * 0.85) f.push(`HRV ${s.hrv3} ms vs your usual ${s.hrvBase}: recovery is down.`);
  return f;
}
