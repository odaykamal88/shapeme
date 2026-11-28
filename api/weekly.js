import { authed } from '../lib/auth.js';
// Sunday weekly review, triggered by Vercel Cron (05:00 UTC = 07:00 Cairo). Silent: it stores the recap, diet review and
// habit tips; the Sunday evening recap (api/evening.js) shows them folded in one message.
// Food + training recap, "pushing too hard" flags, and a re-planned week when flags fire.
import { allEvents, allMeasurements, getOwner, rollupMonths, writeDoc, addEvent } from '../lib/store.js';
import { weekStats, allMeas } from '../lib/summary.js';
import { ask } from '../lib/claude.js';
import { send } from '../lib/tg.js';
import { adherence, ladderProgress, setsPerMuscle, fmtSets } from '../lib/training.js';
import { loadFlags } from '../lib/load.js';
import { adaptWeek, adaptMessage } from '../lib/adapt.js';
import { esc, fold, foldLong } from '../lib/templates.js';
import { MILESTONES } from '../lib/plan.js';
import { dietReview, dietMessage } from '../lib/diet.js';
import { refreshTips, habitsMessage } from '../lib/habits.js';
import { getProfile, personaPrompt, consolidate } from '../lib/persona.js';

export default async function handler(req, res) {
  if (!authed(req, { cron: true })) return res.status(401).send('no');
  const owner = await getOwner();
  if (!owner) return res.send('no owner yet');
  // Housekeeping first: roll finished months into one file each, then read the full history once.
  await rollupMonths(21).catch(e => console.error('rollup', e));
  const ev = await allEvents();
  await writeDoc('bests', { values: Object.fromEntries(ladderProgress(ev).filter(l => l.best != null).map(l => [l.key, l.best])), at: Date.now() }).catch(e => console.error('bests', e));
  const meas = await allMeasurements();
  const stats = weekStats(ev, meas, 7);
  const a = adherence(ev, 7);
  const flags = loadFlags(ev, allMeas(meas));
  const from = stats.from;
  stats.training = {
    gymSessions: a.sessions7, gymAim: '4–5', homeSessions: a.home7, homeAim: '3–5', milestones: MILESTONES, mornings: a.mornings7, morningStreak: a.morningStreak,
    setsPerMuscle: setsPerMuscle(ev, 7),
    workouts: ev.filter(e => e.type === 'workout' && e.date >= from).map(e => `${e.date}: ${(e.exercises || []).map(x => `${x.name} ${fmtSets(x)}`).join('; ')}`),
    ladders: ladderProgress(ev).map(({ key, best, target }) => ({ key, best, target }))
  };
  const profile = await getProfile();
  const dietP = dietReview(ev, allMeas(meas), profile); // runs alongside the recap
  await (await import('../lib/energy.js')).calibrate(ev, allMeas(meas)).catch(e => console.error('calibrate', e)); // burn formula vs his real maintenance
  const text = await ask({
    system: `${personaPrompt(profile, ev)}
Write his Sunday recap, under 180 words, honest but in your voice (one light line of humour is welcome).
Format: line 1 = verdict (ON TRACK / OFF TRACK, or EARLY READ if tracking started less than 7 days ago) for the current phase.
Then a blank line and <b>Food</b> with 1–2 bullets (where calories came from, protein).
Blank line, <b>Training</b> with 2–3 bullets (gym vs 4–5 and home vs 3–5 sessions, volume by muscle, progress or stalls on lifts and skills).
Blank line, <b>Steps</b> in one line.
If a milestone date has passed or is within 7 days, compare him to it in one line. Blank line, then exactly one change for next week, in bold. Do not repeat the load flags; they are shown separately.
If food was logged on fewer than half of the days since tracking started, mention it once, briefly; if tracking started this week, frame it as week one.`,
    content: JSON.stringify(stats),
    maxTokens: 4000, effort: 'medium'
  });
  const load = flags.length ? `\n\n⚠️ <b>Pushing too hard</b>\n${flags.map(f => `• ${esc(f)}`).join('\n')}` : '\n\n✅ <b>Load:</b> no signs of overdoing it.';
  // Nothing is sent in the morning: the Sunday evening recap shows all of this as tap-to-expand sections.
  await addEvent('weekly_recap', { text: String(text).trim(), load: load.trim() });
  await dietP.catch(e => console.error('diet review', e));
  await refreshTips(ev).catch(e => console.error('habits', e));
  await consolidate(ev).catch(e => console.error('memory', e));
  // Re-planning happens in the nightly loop now (silent).
  res.send('stored for the Sunday evening recap');
}
