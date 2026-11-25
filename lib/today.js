// The pinned "Today" message: one message per day, edited in place after every log, so the day's state
// is always at the top of the chat. A new one is created (and pinned silently) on the first update of a day.
import { readDoc, writeDoc, recentDays } from './store.js';
import { send, edit, pin, unpin } from './tg.js';
import { dayFood } from './summary.js';
import { todayTarget } from './diet.js';
import { dayPlan } from './adapt.js';
import { homeFor, GYM_ORDER, HOME_ORDER } from './plan.js';
import { dayRecovery } from './recovery.js';
import { fmtSleep } from './schedule.js';
import { CONFIG, today } from './config.js';

const n = x => Math.round(x).toLocaleString('en-US');

export function todayStatus(ev) {
  const t = today(), f = dayFood(ev, t), tt = todayTarget(ev), r = dayRecovery(ev, t);
  const gym = dayPlan(ev, t), home = homeFor(t, ev);
  const ws = ev.filter(e => e.type === 'workout' && e.date === t);
  const skipped = ev.filter(e => e.type === 'workout_skip' && e.date === t).map(e => e.session);
  const gymDone = ws.find(w => GYM_ORDER.includes(w.session) || w.session === 'class');
  const homeDone = ws.find(w => HOME_ORDER.includes(w.session));
  const routine = ev.some(e => e.type === 'routine' && e.date === t) || ws.some(w => w.session === 'morning');
  const steps = ev.filter(e => e.type === 'steps' && e.date === t).map(e => e.steps).pop() ?? null;
  const d = new Date(`${t}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  const type = tt.cycling ? (tt.type === 'feast' ? ' · 🍖 feast day' : tt.type === 'high' ? ' · 🔼 high day' : ' · 🔽 low day') : '';
  const gymTxt = gymDone ? `🏋️ ${gymDone.session} ✅` : skipped.some(s => GYM_ORDER.includes(s)) ? '🏋️ skipped' : gym.dayType ? `🏋️ ${gym.name.split(' — ')[0]} ⬜` : null;
  const homeTxt = homeDone ? `🏠 ${homeDone.session} ✅` : home.dayType ? `🏠 ${home.key} ⬜` : null;
  const rec = [r.sleep_h != null && `🛌 ${fmtSleep(r.sleep_h)}`, r.wood != null && `wood ${r.wood ? '✅' : '❌'}`, r.energy != null && `energy ${r.energy}`, r.knee != null && `knee ${r.knee}`].filter(Boolean).join(' · ');
  const left = [
    f.kcal < tt.kcal - 100 && `${n(tt.kcal - f.kcal)} kcal`, f.kcal > tt.kcal + 100 && `over by ${n(f.kcal - tt.kcal)} kcal`,
    tt.protein - f.protein > 20 && `${n(tt.protein - f.protein)} g protein`,
    !routine && 'routine', !gymDone && gym.dayType === true && !skipped.length && `gym ${gym.key || ''}`.trim(), !homeDone && home.dayType === true && `home ${home.key}`,
    (steps ?? 0) < CONFIG.stepsTarget && `${n(CONFIG.stepsTarget - (steps ?? 0))} steps`
  ].filter(Boolean);
  // Collapsed: one line you can tap open.
  const head = `📌 ${n(f.kcal)}/${n(tt.kcal)} kcal · ${n(f.protein)}/${tt.protein} g${left.length ? ` · ${left.length} to go` : ' · all done 👌'}`;
  const body = [`<b>${d}</b>${type}`, [`🧘 ${routine ? '✅' : '⬜'}`, gymTxt, homeTxt].filter(Boolean).join(' · '),
    `👟 ${steps != null ? n(steps) : '–'} / ${n(CONFIG.stepsTarget)}${rec ? ` · ${rec}` : ''}`, left.length ? `Left: ${left.join(' · ')}` : ''].filter(Boolean).join('\n');
  return `${head}\n<blockquote expandable>${body}</blockquote>`;
}

export async function refreshToday(chat, ev = null) {
  try {
    ev = ev || await recentDays(21);
    const t = today(), doc = await readDoc('pin'), text = todayStatus(ev);
    if (doc?.id) { // same pinned message every day, edited in place
      const r = await edit(chat, doc.id, text);
      if (r.ok || /not modified/i.test(r.description || '')) { if (doc.date !== t) await writeDoc('pin', { ...doc, date: t }); return; }
    }
    const r = await send(chat, text, { silent: true });
    if (!r?.ok) return;
    if (doc?.id) await unpin(chat, doc.id).catch(() => {});
    await pin(chat, r.result.message_id);
    await writeDoc('pin', { date: t, id: r.result.message_id });
  } catch (e) { console.error('refreshToday', e); }
}
