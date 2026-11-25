// Daily cards with a copy-paste block pre-filled from the plan and last performance.
import { MORNING } from './plan.js';
import { lastPerformance, setsOf, ladderProgress, progressionHint } from './training.js';
import { dayRecovery } from './recovery.js';
import { cueFor } from './cues.js';
import { ALL_EXERCISES, homeFor, walkFor, ruckKg, RUCK, MILESTONES, TESTS, blockFor } from './plan.js';
import { dayPlan } from './adapt.js';
import { CONFIG } from './config.js';
import { today } from './config.js';

export const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// "4 × 5–6" → "5,5,5,5"; "5 × 10–15 s" → "10s,10s,10s,10s,10s"; "3 × 8/side" → "8,8,8 /side"
function fromTarget(target, name = '') {
  const m = String(target).match(/^(\d+)\s*[×x]\s*(.+)$/);
  if (!m) return target;
  const n = +m[1], rest = m[2];
  if (/max/i.test(rest)) return Array(n).fill(/hold|hang|l-sit|plank/i.test(`${rest} ${name}`) ? '?s' : '?').join(',');
  const hold = rest.match(/(\d+)(?:–\d+)?\s*s\b/);
  if (hold) return Array(n).fill(`${hold[1]}s`).join(',');
  const reps = rest.match(/(\d+)(?:–\d+)?(\/\w+)?/);
  return reps ? Array(n).fill(reps[1]).join(',') + (reps[2] ? ` ${reps[2]}` : '') : target;
}

function fromLast(x) {
  const sets = setsOf(x);
  if (sets.length && sets.every(s => s.seconds != null)) return sets.map(s => `${s.seconds}s`).join(',');
  const reps = sets.map(s => s.reps ?? '?').join(',');
  const ws = [...new Set(sets.map(s => s.weight_kg).filter(w => w != null))];
  return reps + (ws.length === 1 ? (ws[0] ? ` @${ws[0]}kg` : ' BW') : ws.length ? ` @${sets.map(s => s.weight_kg ?? 0).join('/')}kg` : '');
}

// Which part of the day an exercise belongs to: the main session, conditioning (swim/jog) or the home session.
// Plan exercises carry their own area (default session); adjusted-plan exercises borrow it from the catalog by plan_id.
export const areaOf = e => e.area || (e.muscle ? 'session' : ALL_EXERCISES.get(e.plan_id)?.area) || 'session';

export function sessionCard(events, plan, { only = null } = {}) {
  if (only) plan = { ...plan, exercises: plan.exercises.filter(e => only.includes(areaOf(e))) };
  const b = plan.block;
  const icon = plan.kind === 'home' ? '🏠' : '🏋️';
  const head = [`${icon} <b>${esc(plan.name)}</b>${b ? ` · ${esc(b.name)}` : ''}${plan.adapted ? ' (adjusted)' : ''}`];
  if (plan.reason) head.push(`<i>${esc(plan.reason)}</i>`);
  if (b?.note) head.push(`<i>${esc(b.note)}</i>`);
  if (b?.type === 'test') head.push(`<i>Tests this week: ${esc(TESTS)}</i>`);
  if (plan.warmup) head.push(`<blockquote expandable>🔥 Warm-up (8 min): ${esc(plan.warmup)}</blockquote>`);
  const targets = [], copy = plan.key ? [`session ${plan.key}`] : [];
  for (const e of plan.exercises) {
    const cue = cueFor(e) ? ` · <i>${esc(cueFor(e))}</i>` : '';
    if (e.circuit) { targets.push(`• ${esc(e.name)} — ${esc(e.target)}${cue}: ${e.circuit.map(c => `${c.name} ${c.target}`).join(', ')}`); copy.push(`${e.name}: ${e.target} done`); continue; }
    const last = e.id ? lastPerformance(events, e.id) : null;
    const hint = last ? progressionHint(last) : null;
    targets.push(`• ${esc(e.name)} — ${esc(e.target)}${cue}${last ? ` <i>(last ${last.date.slice(5)}: ${esc(fromLast(last))})</i>` : ''}${hint ? `\n   ➡️ ${esc(hint)}` : ''}`);
    copy.push(`${e.name}: ${last ? fromLast(last) : fromTarget(e.target, e.name)}`);
  }
  return `${head.join('\n')}\n\n${targets.join('\n')}`;
}

// The morning routine: the nightly loop may have tuned it (latest `routine_plan` event in 30 days), else the programme's.
export function currentRoutine(events) {
  const p = (events || []).filter(e => e.type === 'routine_plan' && e.ts > Date.now() - 30 * 864e5).sort((a, b) => b.ts - a.ts)[0];
  return p?.items?.length ? p.items.map(x => ({ ...x, id: x.id || null })) : MORNING;
}
export function morningCard(events, { folded = false } = {}) {
  const list = currentRoutine(events).map(e => `• ${esc(e.name)} — ${esc(e.target)}${cueFor(e) ? ` · <i>${esc(cueFor(e))}</i>` : ''}`).join('\n');
  const head = `🧘 <b>Morning routine</b> (20 min). When done, just say <i>"morning done, dead hang 50s"</i>.`;
  return folded ? fold(head, list) : `${head}\n\n${list}`;
}

// Third morning ping: steps/walks, conditioning and home work, plus today's food target.
// Third morning ping: walk or ruck, today's home session (by order), and the food target.
export function otherCard(events, date = today(), { foodLine = '', stepsYesterday = null } = {}) {
  const steps = CONFIG.stepsTarget, w = walkFor(date), b = blockFor(date);
  const walk = w === 'ruck'
    ? `🎒 <b>Ruck day</b>: ${RUCK.minutes} min brisk with <b>${ruckKg(date)} kg</b> (flat routes while the knee settles). Counts toward ${steps.toLocaleString('en-US')} steps.`
    : `🚶 <b>${w === 'easy walk' ? 'Easy walk' : 'Walk'}</b> toward ${steps.toLocaleString('en-US')} steps${stepsYesterday != null ? ` (yesterday ${stepsYesterday.toLocaleString('en-US')})` : ''}.`;
  const parts = [`📋 <b>Today's other work</b>`, walk];
  const h = homeFor(date, events);
  if (h.dayType) {
    const card = sessionCard(events, { ...h, warmup: null, reason: h.swapped ? 'H2 waits a day: B and H2 both hit the legs' : null });
    parts.push(`${h.dayType === 'optional' ? '<i>Optional today</i>\n' : ''}${card.replace(/^🏠 /, '🏠 <b>Home, 25 min</b>: ').replace('✍️ Copy, edit and send back (or send a voice note):', '✍️ When done, copy, edit and send:')}`);
  } else if (b?.type === 'taper') parts.push('🧳 Travel or ski day: morning routine, H3 with what you packed, and a walk. On ski days the skiing is the training.');
  if (foodLine) parts.push(foodLine);
  return parts.join('\n\n');
}

// Morning: one simple ping. Wood is a tap; the rest is a voice note or a line of text.
export function morningPing(events) {
  const t = today(), r = dayRecovery(events, t), ms = MILESTONES.find(m => m.date === t);
  const ask = ['weight', r.sleep_h == null && 'sleep', r.hrv == null && 'HRV'].filter(Boolean).join(', ');
  const tape = t.slice(8) === '01' || ms ? ` Tape day too: waist, shoulders, arms, chest, forearm.` : '';
  const photos = ms ? ` 📸 ${esc(ms.name)} checkpoint: photos today.` : '';
  return `☀️ Morning. Check-in when you're up: ${ask}. Say it or type it.${tape}${photos}`;
}

// One message after the check-in: today's shape, the nightly focus, and the routine folded underneath.
export function todayText(events, { tt = null, gymHour = 16, homeHour = 18, focus = null, extra = null } = {}) {
  const t = today(), gym = dayPlan(events, t), home = homeFor(t, events);
  const bits = [gym.dayType ? `🏋️ ${esc(gym.name.split(' — ')[0])}${gym.dayType === 'optional' ? ' (optional)' : ` at ~${gymHour}:00`}` : '🏋️ rest',
    home.dayType ? `🏠 ${esc(home.key)}${home.dayType === 'optional' ? ' (optional)' : ` ~${homeHour}:00`}` : null,
    walkFor(t) === 'ruck' ? `🎒 ruck ${ruckKg(t)} kg` : '🚶 walk',
    tt ? `🍽 ${tt.cycling ? (tt.type === 'high' ? 'high ' : tt.type === 'feast' ? 'feast ' : 'low ') : ''}${tt.kcal.toLocaleString('en-US')} kcal` : null].filter(Boolean);
  const routineDone = (events || []).some(e => e.type === 'routine' && e.date === t);
  const head = `📋 <b>Today</b>: ${bits.join(' · ')}${focus ? `\n🎯 <i>${esc(focus)}</i>` : ''}${extra ? `\n${esc(extra)}` : ''}`;
  return routineDone ? head : fold(head, currentRoutine(events).map(e => `• ${esc(e.name)} — ${esc(e.target)}`).join('\n') + '\n\n<i>Then say "morning done".</i>');
}

// Long texts: a short visible head, the rest folded behind Telegram's tap-to-expand quote.
export function fold(head, body) {
  body = String(body || '').trim();
  return body ? `${head}\n<blockquote expandable>${body}</blockquote>` : head;
}
export function foldLong(text, max = 450) {
  text = String(text).trim();
  if (text.length <= max) return text;
  const i = text.indexOf('\n\n');
  return i > 0 && i < max ? fold(text.slice(0, i), text.slice(i + 2)) : text;
}
// Buttons under a session card.
export const workoutButtons = (key, isGym) => ({ inline_keyboard: [
  [{ text: '✅ Done as planned', callback_data: `w:plan:${key}` }, { text: '✏️ Changes', callback_data: `w:chg:${key}` }],
  [{ text: '⏭ Skipped', callback_data: `w:skip:${key}` }, ...(isGym ? [{ text: '🏠 At home today', callback_data: `w:home:${key}` }] : [])],
  ...(isGym ? [[{ text: '🔀 Other session', callback_data: 'p:gym' }]] : [])
] });
// Check-in buttons: tap what's quick, type the numbers.
export function checkinButtons(r = {}) {
  const mark = (on, label) => (on ? '✓ ' : '') + label;
  return { inline_keyboard: [[{ text: mark(r.wood === true, 'wood ✅'), callback_data: 'c:wood:1' }, { text: mark(r.wood === false, 'wood ❌'), callback_data: 'c:wood:0' }]] };
}

// Session picker: the next one in the order first.
export const pickerButtons = next => ({ inline_keyboard: [
  [{ text: `▶️ ${next} (next in order)`, callback_data: `s:${next}` }],
  ['A', 'B', 'C', 'D'].filter(k => k !== next).map(k => ({ text: { A: 'A · push', B: 'B · lower', C: 'C · pull', D: 'D · full body' }[k], callback_data: `s:${k}` }))
] });
