// Treadmill walks count toward the day's steps (the phone usually isn't on him).
// Each steps event holds the day's total: base (phone/typed) + extra (treadmill estimate).
import { recentEvents, addEvent } from './store.js';

const TREADMILL = /treadmill|walking pad|incline walk/i;
const STEPS_PER_KM = 1400; // slow incline walking, shorter stride

const num = s => s == null ? null : +String(s).replace(',', '.');
export function treadmillSteps(x) {
  if (!TREADMILL.test(`${x.name || ''} ${x.note || ''}`)) return 0;
  const t = `${x.name || ''} ${x.note || ''}`;
  let km = num(t.match(/(\d+(?:[.,]\d+)?)\s*km\b(?!\s*\/|\s*ph|\s*per)/i)?.[1]);
  const sec = (x.sets || []).reduce((n, s) => n + (s.seconds || 0), 0) || (num(t.match(/(\d+)\s*min/i)?.[1]) || 0) * 60;
  const kmh = num(t.match(/(\d+(?:[.,]\d+)?)\s*km\s*\/\s*h|(\d+(?:[.,]\d+)?)\s*kph/i)?.slice(1).find(Boolean));
  if (!km && sec && kmh) km = kmh * sec / 3600;
  const steps = km ? km * STEPS_PER_KM : sec ? sec / 60 * 100 : 0;
  return Math.round(steps / 50) * 50;
}

export const dayTreadmill = (ev, date) => ev.filter(e => e.type === 'workout' && e.date === date)
  .flatMap(e => e.exercises || []).reduce((n, x) => n + treadmillSteps(x), 0);

// Re-total the day's steps. base: a new phone/typed total (null = keep the last one).
// includesTreadmill: the new total already counts the treadmill.
export async function syncSteps(date, { base = null, includesTreadmill = false } = {}) {
  const ev = await recentEvents(2);
  const last = ev.filter(e => e.type === 'steps' && e.date === date).pop();
  const extra = includesTreadmill ? 0 : dayTreadmill(ev, date);
  const b = base ?? (last ? (last.base ?? last.steps) : 0);
  if (base == null && (last?.extra || 0) === extra) return null;
  const { pathname } = await addEvent('steps', { steps: b + extra, base: b, extra, ...(extra ? { source: 'treadmill' } : {}) }, date);
  return { base: b, extra, total: b + extra, pathname };
}
