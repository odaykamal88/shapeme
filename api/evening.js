// End-of-day recap, triggered by Vercel Cron (19:30 UTC = 21:30 Cairo; Hobby fires within that hour).
// How today went + tomorrow's first move, then any missing steps/workout as short questions.
import { authed } from '../lib/auth.js';
import { recentEvents, getOwner, writeDoc } from '../lib/store.js';
import { send } from '../lib/tg.js';
import { dayPlan } from '../lib/adapt.js';
import { homeFor, GYM_ORDER, HOME_ORDER } from '../lib/plan.js';
import { dayFood } from '../lib/summary.js';
import { todayTarget } from '../lib/diet.js';
import { eveningRecap } from '../lib/insight.js';
import { habitState } from '../lib/habit.js';
import { fold, workoutButtons } from '../lib/templates.js';
import { dietMessage } from '../lib/diet.js';
import { habitsMessage } from '../lib/habits.js';
import { CONFIG, today } from '../lib/config.js';
import { sendVoice, sendDocument } from '../lib/tg.js';
import { buildReport, solidWeek } from '../lib/report.js';
import { allMeasurements } from '../lib/store.js';
import { allMeas } from '../lib/summary.js';
import { commitDraft, commitButtons, commitText, weekStart } from '../lib/engage.js';
const shift = (d, n) => new Date(new Date(`${d}T12:00:00Z`).getTime() + n * 864e5).toISOString().slice(0, 10);

export default async function handler(req, res) {
  if (!authed(req, { cron: true })) return res.status(401).send('no');
  const owner = await getOwner();
  if (!owner) return res.send('no owner yet');
  const t = today(), ev = await recentEvents(), all = ev.filter(e => e.date === t);
  const f = dayFood(ev, t), tt = todayTarget(ev, t), habit = habitState(ev);
  const gym = dayPlan(ev, t), home = homeFor(t, ev);
  const did = order => all.some(e => (e.type === 'workout' || e.type === 'workout_skip') && order.includes(e.session));
  const steps = all.filter(e => e.type === 'steps').map(e => e.steps).pop();
  const recap = await eveningRecap(ev, { habit }).catch(e => { console.error('recap', e); return ''; });
  const head = `🌙 <b>Today</b>${habit.onboarding ? ` · day ${habit.day} of 20` : ''} · ${f.kcal.toLocaleString('en-US')}/${tt.kcal.toLocaleString('en-US')} kcal · ${f.protein}/${tt.protein} g${steps != null ? ` · ${Math.round(steps / 100) / 10}k steps` : ''}`;
  const asks = [];
  if (steps == null) asks.push(`👟 Steps today? e.g. <i>12400 steps</i>`);
  const gymMissing = gym.dayType === true && !did(GYM_ORDER), homeMissing = home.dayType === true && !did(HOME_ORDER);
  if (gymMissing) asks.push(`🏋️ ${gym.name.split(' — ')[0]}: done, changed or skipped?`);
  else if (homeMissing) asks.push(`🏠 ${home.key}: done, changed or skipped?`);
  // Sundays: the weekly review (stored this morning) rides along as folded sections, still one message.
  const weekly = [];
  if (new Date(`${t}T12:00:00Z`).getUTCDay() === 0) {
    const wr = all.filter(e => e.type === 'weekly_recap').pop(), dp = ev.filter(e => e.type === 'diet_plan' && e.date === t).pop(), ht = ev.filter(e => e.type === 'habit_tips' && e.date === t).pop();
    if (wr) weekly.push(fold('📊 <b>The week</b>', `${wr.text}\n\n${wr.load}`));
    if (dp) weekly.push(fold('🍽 <b>Next week\'s food</b>', dietMessage(dp).replace(/^🍽 <b>Diet for the week<\/b>[^\n]*\n\n/, '')));
    if (ht) weekly.push(fold('🔁 <b>Eating patterns</b>', `${ht.summary}\n${(ht.staples || []).map(s => `• ${s.item}: ${s.tip}`).join('\n')}`));
  }
  const msg = `${head}\n\n${recap}${weekly.length ? `\n\n${weekly.join('\n')}` : ''}${asks.length ? `\n\n${asks.join('\n')}` : ''}`;
  if (req.query.dry) return res.send(msg);
  await writeDoc('last_prompt', { kind: 'evening', ts: Date.now() });
  await send(owner, msg, { markup: gymMissing ? workoutButtons(gym.key, false) : homeMissing ? workoutButtons(home.key, false) : undefined });
  // Saturdays: commit to next week's gym days (one tap per day, then lock it in). Its own short text.
  if (new Date(`${t}T12:00:00Z`).getUTCDay() === 6) {
    const draft = commitDraft(ev, weekStart(t) === t ? t : shift(t, 1));
    await writeDoc('commit_draft', draft);
    await send(owner, commitText(draft), { markup: commitButtons(draft), silent: true });
  }
  // Sundays after a solid week: the one-page report, as a reward (not a routine).
  let report = false;
  if (new Date(`${t}T12:00:00Z`).getUTCDay() === 0 && solidWeek(ev).solid) {
    const pdf = await buildReport(ev, allMeas(await allMeasurements())).catch(e => { console.error('report', e); return null; });
    if (pdf) report = (await sendDocument(owner, pdf, `week-${t}.pdf`, '📄 A solid week earns this: your week on one page.', { silent: true }).catch(() => ({}))).ok;
  }
  res.send(`sent${report ? ' + report' : ''}`);
}
