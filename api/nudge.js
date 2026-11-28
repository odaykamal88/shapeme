// Workout-time ping. Vercel Cron calls this once in each hour from 08:00 to 19:00 Cairo (Hobby: once a day per entry).
// On gym/home days it sends the session card, with tap buttons, at: a snoozed time if he asked ("remind me at 7"),
// else his learned training hour, else 16:00 gym / 18:00 home. Once per day and hour; never in quiet hours.
import { authed } from '../lib/auth.js';
import { writeDoc } from '../lib/store.js';
import { recentEvents, getOwner, markSeen, readDoc } from '../lib/store.js';
import { send } from '../lib/tg.js';
import { dayPlan } from '../lib/adapt.js';
import { homeFor, GYM_ORDER, HOME_ORDER } from '../lib/plan.js';
import { sessionCard, otherCard, workoutButtons } from '../lib/templates.js';
import { usualHour, cairoHour, DEFAULT_HOUR } from '../lib/schedule.js';
import { getProfile } from '../lib/persona.js';
import { today } from '../lib/config.js';
import { habitState, nudgeDue, NUDGES } from '../lib/habit.js';
import { checkinButtons } from '../lib/templates.js';

export default async function handler(req, res) {
  if (!authed(req, { cron: true })) return res.status(401).send('no');
  const owner = await getOwner();
  if (!owner) return res.send('no owner yet');
  const t = today(), h = req.query.hour != null ? Number(req.query.hour) : cairoHour();
  if (h < 7 || h >= 23) return res.send('quiet hours');
  const [ev, profile, o] = await Promise.all([recentEvents(), getProfile(), readDoc('nudge_override')]);
  const ov = o?.date === t ? o : {};
  const did = order => ev.some(e => (e.type === 'workout' || e.type === 'workout_skip') && e.date === t && order.includes(e.session));
  const out = [];

  const gym = dayPlan(ev, t), gymHour = ov.gym ?? usualHour(ev, GYM_ORDER, profile) ?? DEFAULT_HOUR.gym;
  if (gym.dayType === true && gymHour === h && !did(GYM_ORDER) && await markSeen(`nudge_gym_${t}_${h}`)) {
    await writeDoc('last_prompt', { kind: 'workout', ts: Date.now() });
    await send(owner, `⏰ <b>Training time.</b> Tap when done, or tell me what changed.\n\n${sessionCard(ev, gym)}`, { markup: workoutButtons(gym.key, !gym.adapted) });
    out.push('gym');
  }
  const home = homeFor(t, ev), homeHour = ov.home ?? usualHour(ev, HOME_ORDER, profile) ?? DEFAULT_HOUR.home;
  if (home.dayType === true && homeHour === h && !did(HOME_ORDER) && await markSeen(`nudge_home_${t}_${h}`)) {
    await send(owner, otherCard(ev, t), { markup: workoutButtons(home.key, false) });
    out.push('home');
  }
  // Habit nudges (first 20 days, or after a miss): one late-morning check-in nudge, one early-afternoon food nudge. Silent.
  // Messages saved during an AI outage are retried every hour until they go through.
  const { retryQueue } = await import('./telegram.js');
  const retried = await retryQueue(owner).catch(() => 0);
  if (retried) out.push(`retried ${retried}`);
  const { eventOn } = await import('../lib/plan.js');
  if (eventOn(ev, t)) return res.send(`event mode (${eventOn(ev, t).label}): no nudges${out.length ? `; ${out.join(', ')}` : ''}`);
  const hs = habitState(ev);
  if ((h === 10 || h === 11) && nudgeDue(hs, 'checkin') && await markSeen(`habit_checkin_${t}`)) { await send(owner, NUDGES.checkin(hs), { silent: true, markup: checkinButtons({}) }); out.push('checkin nudge'); }
  if ((h === 14 || h === 15) && nudgeDue(hs, 'food') && await markSeen(`habit_food_${t}`)) { await send(owner, NUDGES.food(hs), { silent: true }); out.push('food nudge'); }
  res.send(out.length ? `sent ${out.join(', ')}` : `nothing due (hour ${h}; gym at ${gymHour}${gym.dayType === true ? '' : ' but not a gym day'}; home at ${homeHour}${home.dayType === true ? '' : ' but not a home day'})`);
}
