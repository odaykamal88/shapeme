import { authed } from '../lib/auth.js';
// Receives Health Auto Export (iOS) "REST API" automation posts: steps, sleep, resting heart rate, HRV.
// Automation: metrics Step Count, Sleep Analysis, Resting Heart Rate, Heart Rate Variability; aggregation Day;
// format JSON; URL https://<your-app>/api/health, header x-dashboard-key: <DASHBOARD_KEY>, daily.
import { addEvent } from '../lib/store.js';

const find = (metrics, re) => metrics.find(m => re.test(m.name || ''));
const dateOf = p => String(p.date || p.sleepEnd || p.endDate || '').slice(0, 10);

export default async function handler(req, res) {
  if (!authed(req)) return res.status(401).json({ error: 'send the key in the x-dashboard-key header' });
  const metrics = req.body?.data?.metrics || [];
  const out = {};

  const step = find(metrics, /step/i);
  if (step) {
    const byDate = {};
    for (const p of step.data || []) { const d = dateOf(p); byDate[d] = (byDate[d] || 0) + Math.round(p.qty || 0); }
    for (const [date, steps] of Object.entries(byDate)) await addEvent('steps', { steps, source: 'apple_health' }, date);
    out.stepDays = Object.keys(byDate).length;
  }

  // One recovery event per day with whatever of sleep / RHR / HRV arrived.
  const rec = {};
  const add = (d, k, v) => { if (d && v != null && !Number.isNaN(v)) (rec[d] ||= {})[k] = Math.round(v * 10) / 10; };
  for (const p of find(metrics, /sleep/i)?.data || []) {
    const hours = p.totalSleep ?? p.asleep ?? (p.qty != null ? p.qty : null) ?? (p.core != null ? (p.core || 0) + (p.deep || 0) + (p.rem || 0) : null);
    add(dateOf(p), 'sleep_h', hours);
  }
  for (const p of find(metrics, /resting_heart|resting heart/i)?.data || []) add(dateOf(p), 'rhr', p.qty ?? p.Avg ?? p.avg);
  for (const p of find(metrics, /variability|hrv/i)?.data || []) add(dateOf(p), 'hrv', p.qty ?? p.Avg ?? p.avg);
  for (const [date, r] of Object.entries(rec)) await addEvent('recovery', { ...r, source: 'apple_health' }, date);
  out.recoveryDays = Object.keys(rec).length;

  res.json({ ok: true, ...out });
}
