// Habit formation for the first 20 days (then it fades): tiny versions, anchored and capped nudges,
// immediate specific encouragement, "never miss twice", no guilt. Pure rules, no API calls.
import { today } from './config.js';
import { dataContext } from './persona.js';

export const ONBOARDING_DAYS = 20;
const shift = (d, n) => new Date(new Date(`${d}T12:00:00Z`).getTime() + n * 864e5).toISOString().slice(0, 10);
const checkedIn = (ev, d) => ev.some(e => e.date === d && (e.type === 'recovery' || e.type === 'routine'));
const ateLogged = (ev, d) => ev.some(e => e.date === d && e.type === 'food');

function streak(ev, has) {
  let n = 0, d = today();
  if (!has(ev, d)) d = shift(d, -1); // today not done yet doesn't break it
  while (has(ev, d)) { n++; d = shift(d, -1); }
  return n;
}

export function habitState(ev) {
  const t = today(), y = shift(t, -1), dc = dataContext(ev);
  const day = dc.trackingStarted ? Math.round((new Date(`${t}T12:00:00Z`) - new Date(`${dc.trackingStarted}T12:00:00Z`)) / 864e5) + 1 : 1;
  const lastLog = Math.max(0, ...ev.filter(e => ['food', 'recovery', 'workout', 'steps', 'routine', 'chat'].includes(e.type)).map(e => e.ts));
  return {
    day, onboarding: day <= ONBOARDING_DAYS,
    checkinStreak: streak(ev, checkedIn), foodStreak: streak(ev, ateLogged),
    checkedInToday: checkedIn(ev, t), foodToday: ateLogged(ev, t),
    missedCheckinYesterday: !checkedIn(ev, y), missedFoodYesterday: !ateLogged(ev, y),
    activeRecently: Date.now() - lastLog < 90 * 60 * 1000
  };
}

// Is a gentle nudge warranted? Only during onboarding, or after a miss ("never miss twice"); never if he's been active.
export function nudgeDue(s, kind) {
  if (s.activeRecently) return false;
  if (kind === 'checkin') return !s.checkedInToday && (s.onboarding || s.missedCheckinYesterday);
  if (kind === 'food') return !s.foodToday && (s.onboarding || s.missedFoodYesterday);
  return false;
}

export const NUDGES = {
  checkin: s => s.missedCheckinYesterday && !s.onboarding
    ? '☀️ Yesterday was quiet, no drama. Never miss twice: one tap on wood keeps it alive.'
    : '☀️ Two-second check-in: tap wood, say your weight when you can.',
  food: s => s.missedFoodYesterday && !s.onboarding ? '📸 Never miss twice: one photo of your next meal is the whole job today.' : '📸 Before your next bite: snap it. That’s the whole job.'
};

// Milestones worth a short, specific note (identity, not points).
export function celebration(s) {
  const m = { 3: 'Three mornings in a row. That’s how it starts.', 7: 'A full week of check-ins. This is becoming who you are, not something you do.',
    14: 'Two weeks straight. The habit is doing the work now, not willpower.', 20: 'Day 20 of check-ins. Toothbrush test passed: it’s automatic. I’ll nudge less from here.' };
  if (m[s.checkinStreak]) return { key: `streak_${s.checkinStreak}`, text: `🔥 ${m[s.checkinStreak]}` };
  // Coming back after a missed day matters more than any streak.
  if (s.day > 2 && s.checkedInToday && s.missedCheckinYesterday) return { key: 'comeback', text: '👊 Back on it. Coming back fast is the habit that matters most.' };
  return null;
}
