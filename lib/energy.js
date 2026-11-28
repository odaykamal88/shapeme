// Energy balance: estimated calories burned vs eaten, per day and for the Sun–Sat week so far.
// Burn = resting base + steps + sessions, then scaled by a calibration factor learned from his real
// intake vs weight trend (weekly job). Always shown as an estimate.
import { CONFIG, today } from './config.js';
import { dayFood } from './summary.js';
import { estimateMaintenance } from './diet.js';
import { readDoc, writeDoc } from './store.js';

const shift = (d, n) => new Date(new Date(`${d}T12:00:00Z`).getTime() + n * 864e5).toISOString().slice(0, 10);
const r50 = n => Math.round(n / 50) * 50;
const SESSION_KCAL = { A: 250, B: 350, C: 250, D: 350 }; // home sessions 150

// body: { weight, heightCm, age, factor } (doc `body`; weight kept fresh by every weigh-in).
export const getBody = async () => ({ ...CONFIG.body, ...((await readDoc('body')) || {}) });
export const saveWeight = async weight => writeDoc('body', { ...((await readDoc('body')) || {}), weight, weightAt: Date.now() });

export function burnEstimate(events, date, body = CONFIG.body) {
  const w = body.weight || 78;
  // Resting + daily life (steps excluded): Mifflin-St Jeor x 1.15 when height is known, else ~24 kcal/kg.
  const base = body.heightCm ? (10 * w + 6.25 * body.heightCm - 5 * (body.age || 38) + 5) * 1.15 : 24 * w;
  const steps = events.filter(e => e.type === 'steps' && e.date === date).map(e => e.steps).pop() || 0;
  const sessions = [...new Set(events.filter(e => e.type === 'workout' && e.date === date && e.session && e.session !== 'morning').map(e => e.session))];
  const training = sessions.reduce((n, s) => n + (SESSION_KCAL[s] ?? 150), 0);
  const fromSteps = steps * 0.0005 * w, f = body.factor || 1;
  return { kcal: r50((base + fromSteps + training) * f), base: Math.round(base * f), fromSteps: Math.round(fromSteps * f), training: Math.round(training * f), steps, stepsLogged: steps > 0, calibrated: f !== 1 };
}

// One day: eaten vs burned (null when no food was logged that day).
export function dayBalance(events, date, body) {
  const f = dayFood(events, date), b = burnEstimate(events, date, body);
  return f.meals ? { date, eaten: f.kcal, burned: b.kcal, diff: f.kcal - b.kcal, stepsLogged: b.stepsLogged } : { date, eaten: null, burned: b.kcal, diff: null, stepsLogged: b.stepsLogged };
}

// Sun..date: sum over days with food logged. kg ≈ diff / 7700.
export function weekBalance(events, date = today(), body) {
  const start = shift(date, -new Date(`${date}T12:00:00Z`).getUTCDay()), days = [];
  for (let d = start; d <= date; d = shift(d, 1)) days.push(dayBalance(events, d, body));
  const logged = days.filter(d => d.diff != null), diff = logged.reduce((s, d) => s + d.diff, 0);
  return { days, loggedDays: logged.length, diff, kg: +(diff / 7700).toFixed(2) };
}

const sign = n => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${Math.abs(Math.round(n)).toLocaleString('en-US')}`;
export const balanceWord = n => n == null ? '' : n <= -150 ? 'deficit' : n >= 150 ? 'surplus' : 'about even';

// Lines for the evening recap header and the pinned status.
export function balanceLine(events, date = today(), body) {
  const d = dayBalance(events, date, body), w = weekBalance(events, date, body);
  if (d.diff == null && !w.loggedDays) return null;
  const day = d.diff == null ? `🔥 burned ~${d.burned.toLocaleString('en-US')} (no food logged)` : `🔥 ate ${d.eaten.toLocaleString('en-US')} · burned ~${d.burned.toLocaleString('en-US')}${d.stepsLogged ? '' : ' (steps not in yet)'} · <b>${sign(d.diff)}</b> ${balanceWord(d.diff)}`;
  const week = w.loggedDays ? `\n⚖️ Week so far: <b>${sign(w.diff)}</b> kcal over ${w.loggedDays} logged day${w.loggedDays === 1 ? '' : 's'} (≈ ${w.kg > 0 ? '+' : w.kg < 0 ? '−' : ''}${Math.abs(w.kg)} kg)` : '';
  return day + week;
}

// Weekly calibration: if real maintenance (intake vs weight trend, 21 days) is known, scale the formula to match it.
export async function calibrate(events, meas) {
  const m = estimateMaintenance(events, meas);
  if (!m) return null;
  const body = await getBody(), raw = { ...body, factor: 1 };
  const from = shift(today(), -20), dates = [...new Set(events.filter(e => e.type === 'food' && e.date >= from).map(e => e.date))];
  const avg = dates.reduce((s, d) => s + burnEstimate(events, d, raw).kcal, 0) / (dates.length || 1);
  const factor = Math.max(0.85, Math.min(1.15, +(m.kcal / avg).toFixed(3)));
  await writeDoc('body', { ...((await readDoc('body')) || {}), factor, calibratedAt: Date.now(), maintenance: m.kcal });
  return { factor, maintenance: m.kcal, formulaAvg: Math.round(avg) };
}
