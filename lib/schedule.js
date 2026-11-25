// Learns when he usually trains, so the workout card can arrive around then instead of at 7:30.
// Source: the Cairo hour of logged gym (or home) sessions over the last 21 days, or an explicit
// "I train at 6pm" in the coach's memory. Logs usually come at the end, so the ping is an hour earlier.
import { CONFIG, today } from './config.js';

const hourOf = ts => Number(new Date(ts).toLocaleString('en-GB', { timeZone: CONFIG.tz, hour: '2-digit', hour12: false })) % 24;
export const cairoHour = () => hourOf(Date.now());
export const fmtSleep = h => { if (h == null) return null; const H = Math.floor(h), M = Math.round((h - H) * 60); return M === 60 ? `${H + 1} h` : M ? `${H} h ${M} min` : `${H} h`; };

function fromNotes(profile) {
  for (const n of profile?.notes || []) {
    const m = n.match(/train(?:s|ing)?\b[^.]*?\bat (\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
    if (m) { let h = Number(m[1]); if (/pm/i.test(m[3] || '') && h < 12) h += 12; if (!m[3] && h < 7) h += 12; return h; }
  }
  return null;
}

export const DEFAULT_HOUR = { gym: 16, home: 18 }; // used until his own time is learned

// Hour (0–23, Cairo) to send the card, or null while there isn't enough to go on.
export function usualHour(events, sessions, profile = null) {
  const explicit = fromNotes(profile);
  if (explicit != null) return Math.max(6, explicit - 0);
  const since = Date.now() - 21 * 864e5;
  const firstPerDay = {};
  events.filter(e => e.type === 'workout' && sessions.includes(e.session) && e.ts > since)
    .forEach(e => { if (!firstPerDay[e.date] || e.ts < firstPerDay[e.date]) firstPerDay[e.date] = e.ts; });
  const hours = Object.values(firstPerDay).map(hourOf).sort((a, b) => a - b);
  if (hours.length < 3) return null;
  return Math.max(6, hours[Math.floor(hours.length / 2)] - 1);
}
