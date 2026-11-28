import { waitUntil } from '@vercel/functions';
import { send as sendRaw, typing, fileBuffer, edit, editButtons, answer, react, buttons } from '../lib/tg.js';
import { refreshToday } from '../lib/today.js';
import { habitState, celebration } from '../lib/habit.js';
import { buildReport, goalsAndChanges } from '../lib/report.js';
import { sendDocument } from '../lib/tg.js';
import { compareProgress } from '../lib/progress.js';
import { foodHabits, habitTip, refreshTips, habitsMessage, tokens, similar } from '../lib/habits.js';
import { transcribe } from '../lib/voice.js';
import { fmtSleep, cairoHour, usualHour, DEFAULT_HOUR } from '../lib/schedule.js';
import { getEquipment, saveEquipment, adaptToPlace, equipmentMessage, norm } from '../lib/equipment.js';
import { dayPlan, adaptWeek, adaptMessage } from '../lib/adapt.js';
import { sessionCard, morningCard, otherCard, todayText, esc, foldLong, workoutButtons, checkinButtons, pickerButtons } from '../lib/templates.js';
import { loadFlags } from '../lib/load.js';
import { allMeas } from '../lib/summary.js';
import { todayTarget, targetNote, dietReview, dietMessage } from '../lib/diet.js';
import { recoveryFlags, dayRecovery } from '../lib/recovery.js';
import { getProfile, remember, personaPrompt, recentChat } from '../lib/persona.js';
import { ask, FOOD_SYSTEM, textSystem, STATS_SYSTEM } from '../lib/claude.js';
import { FOOD, TEXT, STATS } from '../lib/schemas.js';
import { verdict } from '../lib/coach.js';
import { debugLog, addEvent, addMeasurement, recentEvents, allMeasurements, deleteLast, deleteByPath, markSeen, readDoc, writeDoc, savePhoto, listPhotos, deletePhotos, getOwner, setOwner } from '../lib/store.js';
import { today, currentPhase, CONFIG } from '../lib/config.js';
import { dayFood, weekStats } from '../lib/summary.js';
import { treadmillSteps, syncSteps } from '../lib/walk.js';
import { planDiff } from '../lib/plandiff.js';
import { burnEstimate, getBody, saveWeight, dayBalance, weekBalance } from '../lib/energy.js';
import { commitDraft, commitButtons, commitText, weekStart, usualMeals, usualButtons, countdownLine, slipLine, eventLine, sameDayKcal } from '../lib/engage.js';
import { PARSER_CATALOG, sessionFor, homeFor, ALL_EXERCISES, LADDERS, GYM_ORDER, HOME_ORDER } from '../lib/plan.js';
import { plannedSets, setsOf, planCard, lastPerformance, fmtSets, progressionHint, trackValue, trackKey, ladderProgress, adherence, setsPerMuscle } from '../lib/training.js';

const fmt = n => Math.round(n).toLocaleString('en-US');
const send = (chat, text, opts = {}) => sendRaw(chat, text, { silent: true, ...opts });
const pinUpdate = chat => waitUntil(refreshToday(chat));
// Misread signals (Undo / Fix taps, "no, I meant…"), stored with the message that caused them, for the regression set.
const CORRECTION = /^(no\b|nope|wrong|that'?s (not|wrong)|i meant|not what i|you (got|misread|misunderstood)|didn'?t (log|get|understand|record))/i;
async function misread(signal, detail = null) {
  const last = (await debugLog(1)).filter(e => e.type === 'inbound').pop();
  await addEvent('misread', { signal, detail: detail ? String(detail).slice(0, 300) : null, after: last?.text || null, read_as: last?.kinds || null }).catch(() => {});
}
// What the bot last asked him for (routine / workout / checkin / evening), so a bare "done" means that.
const BARE_DONE = /^\W*(done|finished|finished it|did it|all done|completed|complete|yes|yep|ok)\W*$/i;
const whichDone = async chat => { const key = dayPlan(await recentEvents(1), today()).key; return send(chat, 'Done with which one?', { markup: buttons([[['🧘 Morning routine', 'r:done'], [`🏋️ ${key} as planned`, `w:plan:${key}`]]]) }); };
const asked = kind => writeDoc('last_prompt', { kind, ts: Date.now() }).catch(() => {});
const BOTTOM_KEYS = { '🏋️ Workout': 'workout', '📋 Today': '/today', '✍️ Check-in': '/checkin', '↩️ Undo': '/undo' };
const HELP = `Just talk to me: voice notes, photos or a line of text.
• Food: snap it or say it. Corrections update the entry.
• Training: tap ✅ on the card, or say only what changed.
• Morning: tap wood, say weight and sleep.
Ask me anything about your plan, food or progress.

<blockquote expandable>More: /gymdays · /checkin · /morning · /extras · /diet · /habits · /adjust · /week · /skills · /equipment · /compare · /photos · /deletephotos · /reset · "feast Friday" · "remind me at 7" · "no gym today"</blockquote>`;

async function dayLine(events) {
  const d = dayFood(events, today());
  const t = todayTarget(events);
  const note = targetNote(t);
  return `Food today: <b>${fmt(d.kcal)}</b> / ${fmt(t.kcal)} kcal · <b>${d.protein}g</b> / ${t.protein}g protein${note ? `\n<i>Target ${note}.</i>` : ''}`;
}

function trainingLine(events) {
  const t = today();
  const ws = events.filter(e => e.date === t && e.type === 'workout');
  const morning = events.some(e => e.date === t && e.type === 'routine') || ws.some(w => w.session === 'morning');
  const all = ws.flatMap(w => w.exercises || []);
  const part = p => {
    const done = e => all.some(x => (e.id && x.plan_id === e.id) || x.name?.toLowerCase() === e.name.toLowerCase());
    const n = p.exercises.filter(done).length;
    return `${p.name}: ${n}/${p.exercises.length}`;
  };
  const gym = dayPlan(events, t), home = homeFor(t, events);
  const bits = [`morning ${morning ? '✅' : '⬜'}`];
  if (gym.dayType || ws.some(w => GYM_ORDER.includes(w.session))) bits.push(part(gym));
  if (home.dayType || ws.some(w => HOME_ORDER.includes(w.session))) bits.push(part(home));
  return `Training today: ${bits.join(' · ')}`;
}

const hhmm = ts => new Date(ts).toLocaleTimeString('en-GB', { timeZone: CONFIG.tz, hour: '2-digit', minute: '2-digit' });
const todaysFood = ev => ev.filter(e => e.type === 'food' && e.date === today()).sort((a, b) => a.ts - b.ts);
// Yesterday's entries are shown to the parser as 101, 102… so late corrections ("the yogurt last night was…") find them.
const yday = () => today(new Date(Date.now() - 864e5));
const yesterdaysFood = ev => ev.filter(e => e.type === 'food' && e.date === yday()).sort((a, b) => a.ts - b.ts);
// What's stored per day (food, steps, training, check-ins, events), for the coach's "did you get it?" answers.
const recentLogs = (ev, days = 3, body) => Array.from({ length: days }, (_, i) => today(new Date(Date.now() - i * 864e5))).map(d => {
  const f = dayFood(ev, d), on = t => ev.filter(e => e.type === t && e.date === d);
  return { date: d, food: f.meals ? `${f.meals} meal(s), ${f.kcal} kcal` : 'none', steps: on('steps').map(e => e.steps).pop() ?? 'none',
    training: on('workout').map(e => e.session).join(', ') || (on('workout_skip').length ? 'skipped' : 'none'), checkin: on('recovery').length ? 'yes' : 'no',
    event: ev.filter(e => e.type === 'event_mode' && d >= e.from && d <= e.to).pop()?.label || null,
    balance: dayBalance(ev, d, body) };
});
const foodByNumber = (ev, n) => n > 100 ? yesterdaysFood(ev)[n - 101] : todaysFood(ev)[n - 1];
const foodLine = (e, i) => `${i + 1}. ${hhmm(e.ts)} · ${e.meal}${e.cheat ? ' (feast)' : ''} · ${fmt(e.total?.kcal || 0)} kcal · ${(e.items || []).map(x => `${x.name} (${x.portion}) ${x.kcal}`).join('; ')}`;
const MEAL_KEYS = ['meal', 'setting', 'items', 'total', 'hidden_calories', 'confidence', 'missing_info', 'cheat'];
const mealOnly = f => Object.fromEntries(MEAL_KEYS.filter(k => f[k] !== undefined).map(k => [k, f[k]]));

async function logFood(chat, food, extra = {}) {
  const { replacedKcal, editMsgId, userMsgId, date: forDate, ...meta } = extra;
  const d = /^\d{4}-\d{2}-\d{2}$/.test(forDate || '') && forDate <= today() ? forDate : today();
  const tip = habitTip(await recentEvents(1), food);
  const { ts } = await addEvent('food', { ...mealOnly(food), ...meta, ...(tip ? { tip_shown: tip.key } : {}) }, d);
  const ev = await recentEvents(1);
  const items = (food.items || []).map(i => `• ${i.name} (${i.portion}) ~${i.kcal}`).join('\n');
  const hidden = food.hidden_calories?.length ? `\n⚠️ <i>${food.hidden_calories.join('; ')}</i>` : '';
  const head = replacedKcal != null
    ? `✏️ <b>Updated</b>: ${fmt(replacedKcal)} → <b>${fmt(food.total.kcal)} kcal</b>`
    : `🍽 <b>~${fmt(food.total.kcal)} kcal</b>`;
  const f = dayFood(ev, d), tt = todayTarget(ev, d), label = d === today() ? 'Today' : d === today(new Date(Date.now() - 864e5)) ? 'Yesterday' : d.slice(5);
  const text = `${head} · ${food.total.protein_g}P ${food.total.carbs_g}C ${food.total.fat_g}F\n<blockquote expandable>${items}${hidden}</blockquote>\n${label} ${fmt(f.kcal)}/${fmt(tt.kcal)} kcal · ${f.protein}/${tt.protein} g${d === today() ? `\n${verdict(ev, food)}` : ''}${tip ? `\n${tip.text}` : ''}`;
  const markup = buttons([[['✅ Looks right', `f:ok:${ts}`], ['✏️ Fix', `f:fix:${ts}`], ['🗑 Undo', `f:undo:${ts}`]]]);
  let r = null;
  if (editMsgId) { r = await edit(chat, editMsgId, text, markup); if (r.ok && userMsgId) await react(chat, userMsgId, '👌'); }
  if (!r?.ok) r = await send(chat, text, { markup });
  waitUntil(celebrate(chat).catch(() => {}));
  if (r?.ok) { const map = (await readDoc('msgmap')) || {}; map[ts] = r.result.message_id; await writeDoc('msgmap', Object.fromEntries(Object.entries(map).slice(-60))); }
  pinUpdate(chat);
}

async function replaceFood(chat, old, food, note, msgId) {
  await deleteByPath(old._path);
  const editMsgId = ((await readDoc('msgmap')) || {})[old.ts] || null;
  return logFood(chat, { ...food, cheat: !!(food.cheat || old.cheat) }, {
    caption: [old.caption, `correction: ${note}`].filter(Boolean).join(' | ').slice(0, 1500), from: old.from, msg_id: old.msg_id ?? msgId, corrected: true,
    replacedKcal: old.total?.kcal || 0, editMsgId, userMsgId: msgId, date: food.date || old.date
  });
}

async function rebuildDay(chat, meals, note, msgId) {
  const old = todaysFood(await recentEvents(1));
  for (const e of old) await deleteByPath(e._path);
  for (const m of meals) await addEvent('food', { ...mealOnly(m), caption: `day restated: ${note}`.slice(0, 1500), from: 'text', msg_id: msgId, corrected: true });
  const ev = await recentEvents(1);
  pinUpdate(chat);
  const was = old.reduce((t, e) => t + (e.total?.kcal || 0), 0);
  return send(chat, `🔄 <b>Rebuilt today's food</b> (${old.length} old entr${old.length === 1 ? 'y' : 'ies'} replaced, ${fmt(was)} → ${fmt(meals.reduce((t, m) => t + (m.total?.kcal || 0), 0))} kcal)\n\n${todaysFood(ev).map(foodLine).map(l => l.split(' · ').slice(0, 3).join(' · ')).join('\n')}\n\n${await dayLine(ev)}\n\n${verdict(ev)}`);
}

async function deleteFood(chat, all, targets) {
  const list = todaysFood(await recentEvents(1));
  const gone = all ? list : (targets || []).map(n => list[n - 1]).filter(Boolean);
  if (!gone.length) return send(chat, `Nothing matched. Today's food:\n\n${list.map(foodLine).join('\n') || 'nothing logged'}`);
  for (const e of gone) await deleteByPath(e._path);
  const ev = await recentEvents(1);
  pinUpdate(chat);
  return send(chat, `🗑 Removed ${gone.length} entr${gone.length === 1 ? 'y' : 'ies'} (${fmt(gone.reduce((t, e) => t + (e.total?.kcal || 0), 0))} kcal).\n\n${await dayLine(ev)}`);
}

// An exercise counts as logged only with numbers (reps, weight or time); cardio/mobility can be a bare mention.
const hasNumbers = x => ['cardio', 'mobility'].includes(x.muscle) ||
  setsOf(x).some(s => s.reps != null || s.seconds != null || s.weight_kg != null);

const compactSets = x => {
  const ss = setsOf(x); if (!ss.length) return '';
  const same = ss.every(s => s.reps === ss[0].reps && s.weight_kg === ss[0].weight_kg && s.seconds === ss[0].seconds);
  if (!same) return fmtSets(x);
  const s0 = ss[0], w = s0.weight_kg ? ` @${s0.weight_kg} kg` : '';
  return s0.seconds != null ? `${ss.length}×${s0.seconds}s` : `${ss.length}×${s0.reps ?? '?'}${w}`;
};

// Workouts are logged as CHANGES FROM THE PLAN: planned exercises without numbers get the planned sets,
// numbers he gives replace them, "didn't do X" removes X, and anything already logged that day is updated, never duplicated.
async function logWorkout(chat, parsed, raw) {
  if (BARE_DONE.test(String(raw || '').trim()) && (parsed.exercises || []).every(x => !setsOf(x).length) && (await readDoc('last_prompt'))?.kind !== 'workout') {
    return whichDone(chat);
  }
  const evNow = await recentEvents(2), t = today();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(parsed.date || '') && parsed.date <= t ? parsed.date : t;
  const gymPlan = dayPlan(evNow, date), homePlan = homeFor(date, evNow);
  const planned = [...gymPlan.exercises, ...homePlan.exercises].flatMap(e => e.circuit ? [e, ...e.circuit] : [e]);
  const same = (a, b) => (a.plan_id && (b.plan_id === a.plan_id || b.id === a.plan_id)) || similar(tokens(a.name), tokens(b.name));
  const dayWorkouts = evNow.filter(e => e.type === 'workout' && e.date === date && e.session !== 'morning');
  const edits = new Map();
  const editable = w => { if (!edits.has(w._path)) edits.set(w._path, { w, ex: [...(w.exercises || [])] }); return edits.get(w._path).ex; };
  const findLogged = x => { for (const w of dayWorkouts) { const ex = editable(w), i = ex.findIndex(l => same(x, l)); if (i >= 0) return { ex, i }; } return null; };
  const fresh = [], asPlanned = [], custom = [], corrected = [], removed = [], kept = [];
  for (const x0 of parsed.exercises || []) {
    let x = x0;
    const hit = findLogged(x);
    if (/skip|not done|didn'?t do|missed|couldn'?t/i.test(x.note || '')) { if (hit) hit.ex.splice(hit.i, 1); removed.push(x.name); continue; }
    if (hasNumbers(x)) {
      if (hit) { hit.ex[hit.i] = { ...hit.ex[hit.i], ...x, note: 'corrected' }; corrected.push(x); continue; }
      fresh.push(x); custom.push(x); continue;
    }
    if (hit) { kept.push(x.name); continue; }
    const p = planned.find(e => same(x, e));
    if (!p) { fresh.push(x); continue; }
    x = { ...x, plan_id: x.plan_id || p.id || p.plan_id || null, name: p.name, muscle: x.muscle || p.muscle, sets: plannedSets(p, evNow), note: 'as planned' };
    fresh.push(x); asPlanned.push(x);
  }
  const missing = fresh.filter(x => !hasNumbers(x)), valid = fresh.filter(hasNumbers);
  const history = await recentEvents(3);
  const bestBefore = Object.fromEntries(ladderProgress(history.filter(e => !(e.type === 'workout' && e.date === date))).map(l => [l.key, l.best]));
  // Rewrite edited workouts, then add the new exercises.
  for (const { w, ex } of edits.values()) {
    if (ex.length === (w.exercises || []).length && ex.every((e, i) => e === w.exercises[i])) continue;
    await deleteByPath(w._path);
    const { _path, type, ts, ...rest } = w;
    if (ex.length) await addEvent('workout', { ...rest, exercises: ex, edited: true }, w.date);
  }
  const session = parsed.session || (homePlan.exercises.some(e => valid.some(x => same(x, e))) && !gymPlan.exercises.some(e => valid.some(x => same(x, e))) ? homePlan.key : gymPlan.key);
  // How the day compares with the session's plan (lib/plandiff.js).
  const plan = [gymPlan, homePlan].find(p => p.key === session);
  const vsPlan = valid.length && plan ? planDiff(plan.exercises, [...dayWorkouts.flatMap(w => edits.get(w._path)?.ex || w.exercises || []), ...valid]) : null;
  const place = evNow.filter(e => e.type === 'week_plan' && e.where && e.days?.some(d => d.date === date)).sort((a, b) => b.ts - a.ts)[0]?.where || null;
  const tt0 = date === t ? todayTarget(evNow.filter(e => !(e.type === 'day_target' && e.target_date === t)), t) : null;
  const added = valid.length ? await addEvent('workout', { session, exercises: valid, raw, ...(asPlanned.length ? { assumed: asPlanned.map(x => x.name) } : {}), ...(place && GYM_ORDER.includes(session) ? { place } : {}), ...(vsPlan ? { vs_plan: vsPlan } : {}) }, date) : null;
  // Same-day calorie correction: a high day whose legs/intervals were skipped earns less (latest wins, restored if completed later).
  const adj = tt0 && plan ? sameDayKcal(tt0, plan, vsPlan, currentPhase(t).cycling?.low) : null;
  const sameDay = evNow.filter(e => e.type === 'day_target' && e.target_date === t && e.source === 'same_day').pop();
  if (adj && adj.kcal !== sameDay?.kcal) await addEvent('day_target', { target_date: t, kcal: adj.kcal, why: adj.why, source: 'same_day' });
  else if (!adj && sameDay && tt0 && valid.length) await addEvent('day_target', { target_date: t, kcal: tt0.kcal, why: 'full session done', source: 'same_day' });
  const walked = valid.some(x => treadmillSteps(x)) || corrected.some(x => treadmillSteps(x)) ? await syncSteps(date) : null;

  const ev = await recentEvents(2);
  const prs = [...valid, ...corrected].filter(x => { const k = trackKey(x), v = trackValue(x); return k && v != null && (bestBefore[k] == null || v > bestBefore[k]); });
  const total = ev.filter(e => e.type === 'workout' && e.date === date).reduce((n, e) => n + (e.exercises || []).length, 0);
  const when = date === t ? '' : date === today(new Date(Date.now() - 864e5)) ? ' (yesterday)' : ` (${date.slice(5)})`;
  // One line, no reasoning on show: what was logged, plus only what changes his day (PR, new calorie target, steps, a missing number).
  const short = n => esc(String(n).replace(/^(Superset: |\+ )/, '').replace(/\s*\(.*\)$/, ''));
  const nothingNew = kept.length && !asPlanned.length && !custom.length && !corrected.length && !removed.length;
  const bits = [nothingNew ? `🏋️ ${session}${when}: already logged` : `🏋️ <b>${session}${when} logged</b> · ${total} exercise${total === 1 ? '' : 's'}`,
    prs.length ? `🏆 ${prs.map(x => short(x.name)).join(', ')}` : null,
    adj && adj.kcal !== sameDay?.kcal ? `🍽 today ${fmt(adj.kcal)} kcal` : null,
    walked ? `👟 +${walked.extra.toLocaleString('en-US')} steps` : null,
    missing.length ? `sets for ${missing.map(x => short(x.name)).join(', ')}?` : null].filter(Boolean);
  const lines = [bits.join(' · ')];
  await send(chat, lines.join('\n'), added ? { markup: buttons([[['↩️ Undo', `x:${added.pathname}`]]]) } : {});
  pinUpdate(chat);
  // Off-plan sessions are folded into the nightly review (silent), not re-planned on the spot.
}

// Reads a text message with today's context (food logged, today's session and place). Exported for /api/admin?parse=.
export async function parseText(text, replyText = null, sentDate = null) {
  const evNow = await recentEvents(1), foodNow = todaysFood(evNow), foodY = yesterdaysFood(evNow);
  const fixing = await readDoc('fixing'), fixEntry = fixing && Date.now() - fixing.at < 15 * 60e3 ? [...foodNow, ...foodY].find(e => String(e.ts) === String(fixing.ts)) : null;
  const fixNo = fixEntry ? (fixEntry.date === today() ? foodNow.indexOf(fixEntry) + 1 : foodY.indexOf(fixEntry) + 101) : null;
  const todaySession = sessionFor(today(), evNow);
  const placeNow = evNow.filter(e => e.type === 'week_plan' && e.where && e.days?.some(d => d.date === today())).sort((a, b) => b.ts - a.ts)[0] || null;
  const lp = await readDoc('last_prompt'), lpMin = lp ? Math.round((Date.now() - lp.ts) / 60000) : null;
  const routineDone = evNow.some(e => e.type === 'routine' && e.date === today());
  const reply = await ask({
    system: textSystem({ catalog: PARSER_CATALOG, todaySession: `${todaySession.key} (${todaySession.name})`, todayFood: `${foodNow.map(foodLine).join('\n') || '(nothing yet today)'}\nYesterday (${yday()}), numbered from 101 (replacing one keeps its date):\n${foodY.map((e, i) => foodLine(e, i + 100)).join('\n') || '(nothing)'}${fixNo ? `\nHE TAPPED FIX ON #${fixNo}: his message corrects that entry -> food, action "replace", replaces ${fixNo}, the FULL corrected meal (keep every item he didn't change).` : ''}`,
      todayState: `${placeNow ? `today's gym session ${placeNow.key || ''} is already rebuilt as "${placeNow.days[0].name}" for ${placeNow.where}` : `today's gym session is ${todaySession.name} at the gym`}\nTODAY'S PLAN: ${[...dayPlan(evNow, today()).exercises, ...(homeFor(today(), evNow).dayType ? homeFor(today(), evNow).exercises : [])].map(e => `${e.id || e.plan_id || 'custom'}: ${e.name} ${e.target}`).join('; ')}\nLAST THING YOU ASKED HIM: ${lp && lpMin < 240 ? `${lp.kind} (${lpMin} min ago)` : 'nothing recent'}; morning routine ${routineDone ? 'already logged' : 'not logged yet'}.\nAlready logged today: ${evNow.filter(e => e.type === 'workout' && e.date === today()).map(e => `${e.session}: ${(e.exercises || []).map(x => x.name).join(', ')}`).join(' | ') || 'nothing'}` }),
    content: `${sentDate && sentDate !== today() ? `He sent this on ${sentDate} and it is being processed late (the service was down): read "today"/"yesterday" relative to ${sentDate} and set "date" explicitly on every food, steps and workout entry.\n` : ''}Today is ${today()}, time ${hhmm(Date.now())}.${replyText ? `\nHe is replying to your message: "${replyText.slice(0, 600)}"` : ''}\nMessage: ${text}`,
    maxTokens: 8000, schema: TEXT, effort: 'low', tag: 'parse'
  });
  const entries = reply.entries || (reply.entry ? [reply.entry] : [reply]);
  return { entries: entries.length ? entries : [{ kind: 'note', text }], foodNow, placeNow, evNow, fixEntry };
}

async function showPlan(chat, what = 'all', { session = null, training = false } = {}) {
  if (session && /^(A|B|C|D|H1|H2|H3)$/.test(session)) await addEvent('session_choice', { key: session });
  const ev = await recentEvents(2), t = today(), gym = dayPlan(ev, t), home = homeFor(t, ev);
  if (what === 'morning') { await asked('routine'); return send(chat, morningCard(ev)); }
  if (what !== 'home') {
    if (gym.dayType === true || ((training || what === 'gym') && gym.dayType)) await asked('workout'), await send(chat, `${gym.chosen ? '' : gym.dayType === 'optional' ? '<i>Optional today. Next in the order:</i>\n\n' : ''}${sessionCard(ev, gym)}`, { markup: workoutButtons(gym.key, !gym.adapted) });
    else if (training || what === 'gym') await send(chat, `🏋️ <b>Extra training day</b>: next in the order is <b>${esc(gym.name)}</b>. Start it, or pick another.`, { markup: pickerButtons(gym.key) });
    else if (gym.dayType === 'optional') await send(chat, `🏋️ Gym is optional today. Training anyway?`, { markup: pickerButtons(gym.key) });
    else await send(chat, `🏋️ Rest day from the gym. Training anyway?`, { markup: pickerButtons(gym.key) });
    pinUpdate(chat);
    if (training && what === 'gym') return;
  }
  if (what !== 'gym') {
    const tt = todayTarget(ev);
    return send(chat, otherCard(ev, t, { foodLine: `🍽 <b>Food: ${fmt(tt.kcal)} kcal</b>${targetNote(tt) ? ` · ${targetNote(tt)}` : ''}, ${tt.protein} g protein` }), { markup: home.dayType ? workoutButtons(home.key, false) : undefined });
  }
}

async function saveProgress(chat, buf, caption, album = null) {
  const pathname = await savePhoto(today(), buf);
  await addEvent('photo', { pathname, caption: caption || null });
  const n = (await listPhotos()).filter(p => p.split('/').pop().startsWith(today())).length;
  if (album && !(await markSeen(`album_${album}`))) return; // one reply per album
  return send(chat, `📸 Progress photo${album ? 's' : ''} saved privately. Not logged as food.\n\n${album ? 'Then' : 'Send the other angles, then'} /compare.`);
}

// After the check-in (typed or tapped): ONE message with today's shape, the nightly focus and the routine folded. Once a day.
async function afterCheckin(chat) {
  const ev = await recentEvents(1);
  if (await markSeen(`today_card_${today()}`)) {
    const profile = await getProfile(), focus = ev.filter(e => e.type === 'coach_log').pop()?.focus || null;
    await asked(ev.some(e => e.type === 'routine' && e.date === today()) ? 'today' : 'routine');
    await send(chat, todayText(ev, { tt: todayTarget(ev), focus, gymHour: usualHour(ev, GYM_ORDER, profile) ?? DEFAULT_HOUR.gym, homeHour: usualHour(ev, HOME_ORDER, profile) ?? DEFAULT_HOUR.home, extra: [eventLine(ev) || slipLine(ev), eventLine(ev) ? null : countdownLine(ev)].filter(Boolean).join('\n') || null }), { markup: usualButtons(usualMeals(ev)) });
  }
  await celebrate(chat, ev);
}

// Streak milestones (3, 7, 14, 20 days): a short, specific note, once each.
async function celebrate(chat, ev = null) {
  const c = celebration(habitState(ev || await recentEvents(1)));
  if (c && await markSeen(`${c.key}_${today()}`)) await send(chat, c.text);
}

// Fitness screenshot → measured numbers (calories burned, steps, weight, body fat, BMR). One line back.
async function logStats(chat, img, caption) {
  const s = await ask({ system: STATS_SYSTEM, cache: true, content: [
    { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: img } },
    { type: 'text', text: `Today is ${today()} (Cairo). Caption: ${caption || '(none)'}` }], maxTokens: 2000, schema: STATS, effort: 'low', tag: 'stats' });
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s.date || '') && s.date <= today() ? s.date : today();
  const { date: _d, summary, ...nums } = s;
  await addEvent('energy_reading', { ...nums, summary }, d);
  const bits = [];
  if (s.total_kcal) bits.push(`🔥 ${fmt(s.total_kcal)} kcal burned`); else if (s.active_kcal) bits.push(`🔥 ${fmt(s.active_kcal)} active kcal${s.workout_minutes ? ` (${s.workout_minutes} min)` : ''}`);
  if (s.steps) { await syncSteps(d, { base: s.steps, includesTreadmill: /watch|garmin|fitbit|whoop|oura|band/i.test(s.source || '') }); bits.push(`👟 ${fmt(s.steps)} steps`); }
  if (s.weight_kg) { await addMeasurement({ date: d, weight: s.weight_kg, ...(s.body_fat_pct ? { body_fat: s.body_fat_pct } : {}) }); await saveWeight(s.weight_kg); bits.push(`⚖️ ${s.weight_kg} kg${s.body_fat_pct ? ` · ${s.body_fat_pct}% fat` : ''}`); }
  if (s.bmr_kcal) { await writeDoc('body', { ...((await readDoc('body')) || {}), bmr: s.bmr_kcal }); bits.push(`BMR ${fmt(s.bmr_kcal)}`); }
  pinUpdate(chat);
  const when = d === today() ? 'today' : d === yday() ? 'yesterday' : d.slice(5);
  return send(chat, bits.length ? `⌚ ${bits.join(' · ')} (${when}). Measured numbers now replace my estimate.` : `⌚ Couldn't read clear numbers from that (${esc(summary || 'screenshot')}). A closer screenshot of the totals works best.`);
}

async function logRecovery(chat, r, raw, userMsgId = null) {
  const { kind, weight, ...fields } = r;
  if (weight) { await addMeasurement({ date: today(), weight }); await saveWeight(weight); }
  const clean = Object.fromEntries(Object.entries(fields).filter(([, v]) => v != null));
  await addEvent('recovery', { ...clean, source: 'bot' });
  const ev = await recentEvents(2);
  const flags = recoveryFlags(ev);
  if (userMsgId) await react(chat, userMsgId, '👌');
  pinUpdate(chat);
  waitUntil(new Promise(res => setTimeout(res, 1200)).then(() => afterCheckin(chat)).catch(e => console.error('after check-in', e)));
  if (flags.length) return send(chat, `⚠️ ${flags.map(esc).join('\n⚠️ ')}\n<i>/adjust lightens the next days.</i>`);
  if (!userMsgId) return send(chat, `🛌 Logged${weight ? `: ${weight} kg` : ''}.`);
}

async function placeFlow(chat, parsed, placeNow = null) {
  const date = parsed.date || today();
  if (!parsed.where || /^(it|this|that|same|here)$/i.test(parsed.where)) parsed.where = placeNow?.where || 'home';
  let items = (await getEquipment())[norm(parsed.where)] || null;
  if (parsed.equipment?.length) ({ items } = await saveEquipment(parsed.where, parsed.equipment));
  if (!parsed.train_here) return send(chat, `🧰 Saved for <b>${esc(parsed.where)}</b>: ${esc((items || []).join(', '))}.\n\n<i>Say "training at ${esc(parsed.where)} today" and I'll rebuild the session for it.</i>`);
  if (!items?.length) return send(chat, `🧰 What equipment is there at <b>${esc(parsed.where)}</b>? e.g. <i>dumbbells 10–20 kg, bench, bands</i>. I'll remember it.`);
  await typing(chat);
  const ev = await recentEvents(2);
  const r = await adaptToPlace(ev, parsed.where, items, date, { request: [parsed.request, placeNow ? `Make it a different version from the last one: ${placeNow.days[0].exercises.map(e => e.name).join('; ')}` : null].filter(Boolean).join('. ') || null });
  const ev2 = await recentEvents(2), plan = dayPlan(ev2, date);
  pinUpdate(chat);
  await asked('workout');
  return send(chat, `${esc(r.summary)}\n\n${sessionCard(ev2, plan)}`, { markup: workoutButtons(plan.key || r.key, false) });
}

async function replan(chat, ev, flags, why) {
  try { await send(chat, adaptMessage(await adaptWeek(ev, flags, why))); }
  catch (e) { console.error(e); await send(chat, `Could not adjust the plan: ${String(e.message).slice(0, 150)}`).catch(() => {}); }
}

function skillsText(events) {
  return '<b>Skill ladders</b>\n' + ladderProgress(events).map(l => {
    const bar = l.pct == null ? '' : ' ' + '▰'.repeat(Math.round(l.pct * 8)) + '▱'.repeat(8 - Math.round(l.pct * 8));
    const best = l.best == null ? '–' : `${l.best}${l.unit === 'reps' ? '' : l.unit === 'kg' ? ' kg' : ' s'}`;
    return `${l.done ? '✅' : '•'} ${l.name}: ${best}${l.target != null ? ` / ${l.target}` : ''}${bar}`;
  }).join('\n');
}

// Retry queue (doc `retry_queue`): messages that failed because the AI service was down, replayed later with their sent date.
const OUTAGE = /credit balance|overloaded|rate.?limit|Claude API (429|5\d\d)|fetch failed|ECONN|timed? ?out/i;
async function queueRetry(item) {
  const q = (await readDoc('retry_queue')) || [];
  if (item.tries <= 5) q.push({ ...item, at: Date.now() });
  await writeDoc('retry_queue', q.filter(x => Date.now() - x.at < 3 * 864e5).slice(-20));
}
export async function retryQueue(chat) {
  const q = (await readDoc('retry_queue')) || [];
  if (!q.length) return 0;
  await writeDoc('retry_queue', []);
  for (const it of q) await handle({ chat: { id: chat }, message_id: 0, text: it.text, ...(it.reply ? { reply_to_message: { text: it.reply } } : {}) }, { replay: true, sentDate: it.date, tries: it.tries });
  return q.length;
}

async function handle(msg, opts = {}) {
  const chat = msg.chat.id;
  let text = (msg.text || msg.caption || '').trim();

  const owner = await getOwner();
  if (!owner) {
    if (text.startsWith('/start')) {
      await setOwner(chat);
      return send(chat, `Locked to you.\n\n${HELP}`);
    }
    return send(chat, 'Send /start to claim this bot.');
  }
  if (owner !== chat) return; // ignore everyone else
  if (!opts.replay) await retryQueue(chat).catch(e => console.error('retry', e)); // anything saved during an outage goes first

  await typing(chat);

  const voice = msg.voice || msg.audio;
  if (voice) {
    if (!process.env.GROQ_API_KEY) return send(chat, '🎙 Voice notes need a transcription key (GROQ_API_KEY in Vercel). Type it for now.');
    text = await transcribe(voice.file_id);
    if (!text) return send(chat, "🎙 Couldn't make that out. Try again or type it.");
    await send(chat, `🎙 <i>${esc(text)}</i>`);
  }

  if (!/[\p{L}\p{N}]/u.test(text) && !msg.photo && !msg.document && !msg.video && !msg.video_note && !msg.animation) return; // a stray "." or emoji-only message: nothing to log, no AI call
  if (BOTTOM_KEYS[text]) text = BOTTOM_KEYS[text];
  if (text === '/help' || text === '/start') return send(chat, HELP);
  if (text === '/report') return dispatch({ kind: 'report', what: 'pdf' });
  if (text === '/goals') return dispatch({ kind: 'report', what: 'goals' });
  if (text === '/checkin') { await asked('checkin'); const r = dayRecovery(await recentEvents(1), today()); return send(chat, '✍️ <b>Check-in</b>: tap these, then type weight, sleep and HRV (e.g. <i>77.6, slept 7h20, hrv 58</i>).', { markup: checkinButtons(r) }); }
  if (text === '/plan') { const ev = await recentEvents(2); return send(chat, sessionCard(ev, dayPlan(ev, today()))); }
  if (text === '/extras') {
    const ev = await recentEvents(2), tt = todayTarget(ev);
    return send(chat, otherCard(ev, today(), { foodLine: `🍽 <b>Food: ${fmt(tt.kcal)} kcal</b>${targetNote(tt) ? ` · ${targetNote(tt)}` : ''}, ${tt.protein} g protein` }));
  }
  if (text === '/diet') {
    await send(chat, '🍽 Reviewing your last weeks of food and weight…');
    const ev = await recentEvents(2);
    return send(chat, dietMessage(await dietReview(ev, allMeas(await allMeasurements()))));
  }
  if (text === '/compare') {
    await send(chat, '📸 Comparing with your previous set…');
    return send(chat, await compareProgress(await recentEvents(2), await allMeasurements()));
  }
  if (text === '/habits') {
    await send(chat, '🔁 Looking at your eating patterns…');
    return send(chat, habitsMessage(await refreshTips(await recentEvents(2))));
  }
  if (text === '/photos') {
    const ps = await listPhotos();
    const dates = [...new Set(ps.map(p => p.split('/').pop().slice(0, 10)))];
    return send(chat, ps.length ? `📸 ${ps.length} progress photo${ps.length > 1 ? 's' : ''} stored privately, from ${dates.length} session${dates.length > 1 ? 's' : ''}: ${dates.map(d => d.slice(5)).join(', ')}.\n\n/deletephotos removes all of them.` : '📸 No progress photos stored.');
  }
  if (text === '/deletephotos') return send(chat, `🗑 Deleted ${await deletePhotos()} progress photos from storage. (Copies in this Telegram chat are yours to delete.)`);
  if (/^(\/?workout|\/?session|today'?s workout|what'?s (my|the) workout( today)?\??)$/i.test(text)) return showPlan(chat, 'all');
  if (text === '/equipment') return send(chat, equipmentMessage(await getEquipment()));
  if (text === '/morning') return send(chat, morningCard(await recentEvents(2)));
  if (text === '/adjust') {
    const ev = await recentEvents(2);
    await send(chat, '🔄 Re-planning the next 6 days…');
    return replan(chat, ev, loadFlags(ev, allMeas(await allMeasurements())), 'He asked to re-plan the week');
  }
  if (text === '/today') {
    pinUpdate(chat);
    const ev = await recentEvents(1), list = todaysFood(ev);
    return send(chat, `<b>Today's food</b>\n${list.map(foodLine).map(l => l.split(' · ').slice(0, 3).join(' · ')).join('\n') || 'nothing logged yet'}\n\n${await dayLine(ev)}\n\n${verdict(ev)}\n\n${trainingLine(ev)}\n\n<i>Fix anything by saying e.g. "2 was half that", "delete 3", or restate the whole day.</i>`);
  }
  if (text === '/reset') return deleteFood(chat, true, []);
  if (text === '/skills') return send(chat, skillsText(await recentEvents(4)));
  if (text === '/undo') {
    const gone = await deleteLast();
    return send(chat, gone ? `Removed last entry (${gone.type || 'measurement'}, ${gone.date}).` : 'Nothing to undo.');
  }
  if (text === '/gymdays') {
    const t = today(), draft = commitDraft(await recentEvents(), weekStart(t), t);
    await writeDoc('commit_draft', draft);
    return send(chat, commitText(draft), { markup: commitButtons(draft) });
  }
  if (text === '/week') {
    const ev = await recentEvents(2);
    const s = weekStats(ev, await allMeasurements());
    const a = adherence(ev, 7);
    const sets = setsPerMuscle(ev, 7);
    const tt = todayTarget(ev);
    return send(chat, `<b>Last 7 days</b>\nSessions: ${a.sessions7}/6 · mornings: ${a.mornings7}/7 (streak ${a.morningStreak})\nFood: ${s.avgKcal ?? '-'} kcal · ${s.avgProtein ?? '-'}g protein avg over ${s.loggedDays} logged days\nBy setting: ${Object.entries(s.kcalBySetting).map(([k, v]) => `${k} ${fmt(v)}`).join(', ') || '-'}\nSteps: ${s.avgSteps ? fmt(s.avgSteps) : '-'} avg\nThis week's budget: ${fmt(tt.weekUsed)} used of ${fmt(tt.weekBudget)} kcal before today · today ${fmt(tt.kcal)} (${tt.daysLeft} days left)\nSets: ${Object.entries(sets).map(([k, v]) => `${k} ${v}`).join(', ') || '-'}`);
  }

  // An edited message that created a food entry corrects that entry.
  if (opts.edited && text) {
    const old = todaysFood(await recentEvents(1)).find(e => e.msg_id === msg.message_id);
    if (old) {
      const fixed = await ask({
        system: FOOD_SYSTEM, cache: true,
        content: `Previous estimate: ${JSON.stringify(mealOnly(old))}\nHe edited his message to: ${text}\nReturn the full corrected entry.`,
        maxTokens: 8000, schema: FOOD, effort: 'medium', tag: 'food'
      });
      return replaceFood(chat, old, fixed, `edited: ${text}`, msg.message_id);
    }
    return send(chat, "✏️ I saw the edit, but edits only update food entries. For anything else, send the correction as a new message.");
  }

  if (msg.video || msg.video_note || msg.animation) return send(chat, "🎬 I can't read video. Send a screenshot of the screen (watch, app, machine or scale) and I'll pull the numbers.");
  if (msg.document && /^image\//.test(msg.document.mime_type || '')) msg = { ...msg, photo: [{ file_id: msg.document.file_id }] }; // screenshots sent as files
  if (msg.photo) {
    const buf = await fileBuffer(msg.photo[msg.photo.length - 1].file_id);
    // Captioned progress photos skip the food model entirely.
    if (/\b(progress|physique)\b/i.test(text)) return saveProgress(chat, buf, text, msg.media_group_id || null);
    const img = buf.toString('base64');
    const out = await ask({
      system: FOOD_SYSTEM, cache: true,
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: img } },
        { type: 'text', text: `Time in Cairo: ${new Date().toLocaleTimeString('en-GB', { timeZone: CONFIG.tz })}. Caption: ${text || '(none)'}` }
      ],
      maxTokens: 8000, schema: FOOD, effort: 'medium', tag: 'food'
    });
    if (out.image_kind === 'body') return saveProgress(chat, buf, text, msg.media_group_id || null);
    if (out.image_kind === 'stats') return logStats(chat, img, text);
    if (out.image_kind === 'other') return send(chat, "🤔 That doesn't look like food or fitness numbers, so I didn't log anything.");
    return logFood(chat, out, { caption: text || null, from: 'photo', msg_id: msg.message_id });
  }

  if (!text) return send(chat, 'Send a photo or text.');

  let parsedMsg;
  try { parsedMsg = await parseText(text, msg.reply_to_message?.text, opts.sentDate); }
  catch (e) {
    // AI service down (no credits, overloaded, 5xx): keep the message and log it automatically once it's back.
    if (!OUTAGE.test(String(e.message))) throw e;
    await queueRetry({ text, reply: msg.reply_to_message?.text || null, date: opts.sentDate || today(), tries: (opts.tries || 0) + 1 });
    if (!opts.replay) await send(chat, "⏸ Couldn't process that right now (the AI service is unavailable). It's saved, and I'll log it automatically as soon as it's back.");
    return;
  }
  const { entries, foodNow, placeNow, evNow: evParsed, fixEntry } = parsedMsg;
  if (CORRECTION.test(text.trim())) await misread('correction', text);
  waitUntil(addEvent('inbound', { text: text.slice(0, 500), kinds: entries.map(e => e.kind), kind: entries[0]?.kind }).catch(() => {}));
  for (const parsed of entries) await dispatch(parsed);

  async function dispatch(parsed) {
  if (opts.sentDate && !parsed.date && ['food', 'steps', 'workout'].includes(parsed.kind)) parsed.date = opts.sentDate; // a late replay keeps the day he meant
  switch (parsed.kind) {
    case 'food': {
      // A reply after tapping Fix always corrects that entry, never adds a new one.
      const old = (parsed.action === 'replace' && parsed.replaces ? foodByNumber(evParsed, parsed.replaces) : null) || fixEntry;
      if (fixEntry) await writeDoc('fixing', null);
      if (old) return replaceFood(chat, old, parsed, text, msg.message_id);
      return logFood(chat, parsed, { caption: text, from: 'text', msg_id: msg.message_id, date: parsed.date });
    }
    case 'food_day':
      return rebuildDay(chat, parsed.meals || [], text, msg.message_id);
    case 'food_delete':
      return deleteFood(chat, parsed.all, parsed.targets);
    case 'measurement': {
      const { kind, ...m } = parsed;
      const clean = Object.fromEntries(Object.entries(m).filter(([, v]) => v != null));
      await addMeasurement({ date: today(), ...clean });
      const r = clean.shoulders && clean.waist ? ` · S/W ratio ${(clean.shoulders / clean.waist).toFixed(2)}` : '';
      const warn = [
        clean.arms && clean.arms < CONFIG.floors.arms ? `arms below ${CONFIG.floors.arms}"` : null,
        clean.shoulders && clean.shoulders < CONFIG.floors.shoulders ? `shoulders below ${CONFIG.floors.shoulders}"` : null
      ].filter(Boolean);
      return send(chat, `📏 Logged: ${Object.entries(clean).map(([k, v]) => `${k} ${v}`).join(', ')}${r}${warn.length ? `\n⚠️ ${warn.join(', ')} — slow the cut.` : ''}`);
    }
    case 'workout':
      return logWorkout(chat, parsed, text);
    case 'recovery':
      return logRecovery(chat, parsed, '', msg.message_id);
    case 'routine': {
      await addEvent('routine', { routine: 'morning', raw: text });
      const rec = parsed.recovery && Object.values(parsed.recovery).some(v => v != null) ? parsed.recovery : null;
      for (const s of parsed.skills || []) await addEvent('skill', { skill: s.skill, value: s.value, from: 'routine' });
      const ev = await recentEvents(2);
      await react(chat, msg.message_id, '🔥');
      pinUpdate(chat);
      if ((parsed.skills || []).length) await send(chat, `🧘 Streak ${adherence(ev, 28).morningStreak} days · ${parsed.skills.map(s => `${s.skill.replace(/_/g, ' ')} ${s.value}`).join(' · ')}`);
      return rec ? logRecovery(chat, rec, '', msg.message_id) : null;
    }
    case 'skill': {
      const before = ladderProgress(await recentEvents(4)).find(l => l.key === parsed.skill);
      await addEvent('skill', { skill: parsed.skill, value: parsed.value, note: parsed.note || null });
      const l = LADDERS.find(x => x.key === parsed.skill);
      const pr = before && (before.best == null || parsed.value > before.best);
      const hit = l?.target != null && parsed.value >= l.target;
      return send(chat, `🎯 ${l?.name || parsed.skill}: ${parsed.value}${pr ? ' 🏆 PR' : ''}${hit ? ' — target reached ✅' : l?.target != null ? ` (target ${l.target})` : ''}`);
    }
    case 'steps': {
      const r = await syncSteps(parsed.date || today(), { base: parsed.steps, includesTreadmill: !!parsed.includes_treadmill });
      pinUpdate(chat);
      // Always one visible line with the day it landed on (a bare 👍 reaction was easy to miss).
      const sd = parsed.date || today(), dayName = sd === today() ? 'today' : sd === yday() ? 'yesterday' : new Date(`${sd}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
      const n = x => x.toLocaleString('en-US');
      return send(chat, `👟 ${n(r?.total ?? parsed.steps)} steps ${dayName}${r?.extra ? ` (${n(r.base)} + ${n(r.extra)} treadmill)` : ''}`, r?.pathname ? { markup: buttons([[['↩️ Undo', `x:${r.pathname}`]]]) } : {});
    }
    case 'location':
      return placeFlow(chat, parsed, placeNow);
    case 'show_plan':
      return showPlan(chat, parsed.what, { session: parsed.session, training: parsed.training_today });
    case 'feast': {
      await addEvent('feast_plan', { feast_date: parsed.date });
      const ev = await recentEvents(1), tt = todayTarget(ev, parsed.date);
      const d = new Date(`${parsed.date}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' });
      return send(chat, `🍖 <b>Feast booked for ${d}</b>: cap ${fmt(tt.feastCap || 3200)} kcal, and it takes one of the week's high days, so the others run low.\n\n<i>On the night: meat first, then bread or dessert, not both. Spirits with soda or dry wine over beer.</i>`);
    }
    case 'event': {
      const from = /^\d{4}-\d{2}-\d{2}$/.test(parsed.from || '') ? parsed.from : today(), to = /^\d{4}-\d{2}-\d{2}$/.test(parsed.to || '') && parsed.to >= from ? parsed.to : from;
      await addEvent('event_mode', { label: parsed.label || 'Event', from, to, training: parsed.training || 'none' });
      pinUpdate(chat);
      if (to < today()) return send(chat, `👍 ${esc(parsed.label || 'Event')} wrapped. Back to the plan; next session is where you left off.`);
      const day = d => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' });
      return send(chat, `🎉 <b>${esc(parsed.label || 'Event')}</b> ${from === to ? day(from) : `${day(from)}–${day(to)}`}: enjoy it. No ${parsed.training === 'none' ? 'workout ' : ''}nudges, feast-level targets, nothing counts as a miss. Minimums: protein at one meal, water between drinks, a walk. We pick up after.`);
    }
    case 'remember':
      await remember(parsed.fact);
      return send(chat, `🧠 Got it, I'll remember: <i>${esc(parsed.fact)}</i>`);
    case 'query': {
      const ev = await recentEvents(3);
      const profile = await getProfile();
      const stats = weekStats(ev, await allMeasurements(), 14);
      const training = { adherence: adherence(ev, 14), ladders: ladderProgress(ev).map(({ key, best, target, unit }) => ({ key, best, target, unit })), setsPerMuscle7: setsPerMuscle(ev, 7), todaysPlan: (() => { const g = dayPlan(ev, today()), h = homeFor(today(), ev); return { gym: `${g.name} (${g.dayType === true ? 'scheduled' : g.dayType === 'optional' ? 'optional day' : 'rest day from the gym'})`, home: h.dayType ? h.name : 'none', note: 'Gym sessions run in order A→B→C→D; this is the next one after the last logged.' }; })() };
      const history = recentChat(ev);
      const answer = await ask({
        system: `${personaPrompt(profile, ev)}
Answer his message using the data given. When giving food advice, separate his daily staples (small upgrades compound) from occasional meals (situational strategy). Only describe logged entries from the list given; never guess what an entry is. Lead with the answer. 40–90 words by default, one idea per short paragraph; go longer only if he asks for detail. For a day's food plan: the target and why in one line, then at most 4 short meal anchors; if you build them from his usual foods, say so ("from what you usually eat") so nothing looks like an old entry. If it's a follow-up, use the recent conversation.`,
        content: `${history ? `Recent conversation:\n${history}\n\n` : ''}Today's logged food, exactly as stored:\n${todaysFood(ev).map(foodLine).join('\n') || 'nothing logged yet'}\n\nEverything logged, last 3 days (answer "did you get X" from this, not from food alone): ${JSON.stringify(await (async () => { const body = await getBody(); return { days: recentLogs(ev, 3, body), weekSoFar: (({ days, ...w }) => w)(weekBalance(ev, today(), body)) }; })())} (balance = eaten − estimated burn: negative is a deficit. "Calories burned"/deficit questions: use these numbers and say they're estimates; never claim steps are missing when they're listed here)\n\nEating patterns, 14 days (staples vs occasional): ${JSON.stringify((() => { const h = foodHabits(ev, 14); return { loggedDays: h.loggedDays, staples: h.staples.map(({ tokens, ...r }) => r), occasional: h.occasional.map(({ tokens, ...r }) => r), note: h.note }; })())}\n\nToday so far: ${JSON.stringify((() => { const f = dayFood(ev, today()), tt = todayTarget(ev); return { eaten: f.kcal, protein: f.protein, meals: f.meals, target: tt.kcal, proteinTarget: tt.protein, timeCairo: new Date().toLocaleTimeString('en-GB', { timeZone: CONFIG.tz, hour: '2-digit', minute: '2-digit' }), trainingToday: trainingLine(ev) }; })())}\n\nBody and food (14 days):\n${JSON.stringify(stats)}\n\nTraining:\n${JSON.stringify(training)}\n\nHis message: ${text}`,
        maxTokens: 4000, effort: 'medium', tag: 'chat'
      });
      await addEvent('chat', { q: text.slice(0, 500), a: answer.slice(0, 1500) });
      return send(chat, answer);
      return send(chat, answer);
    }
    case 'report': {
      const ev = await recentEvents(), meas = allMeas(await allMeasurements());
      if (parsed.what === 'pdf') {
        await typing(chat);
        const pdf = await buildReport(ev, meas);
        return sendDocument(chat, pdf, `week-${today()}.pdf`, '📄 Your week on one page.', { silent: true });
      }
      const { goals, changes } = goalsAndChanges(ev, meas);
      return send(chat, `🎯 <b>Your goals</b> (fixed)\n${goals.map(g => `• ${esc(g)}`).join('\n')}\n\n🔧 <b>Tailored from your data</b>\n${changes.length ? changes.map(c => `• ${esc(c.date.slice(5))} · ${esc(c.area)}: ${esc(c.text)}`).join('\n') : '• Nothing yet: the plan works as written. I change it only when your data says so.'}\n\n<i>Say "send my report" for the one-page PDF.</i>`);
    }
    case 'snooze': {
      let at = parsed.at_hour;
      if (at != null && at < 12 && (at < 7 || at <= cairoHour())) at += 12; // "at 7" in the afternoon means 19:00
      const h = Math.min(22, Math.max(7, at ?? (cairoHour() + Math.ceil(parsed.in_hours || 1))));
      const o = (await readDoc('nudge_override')) || {};
      const next = { ...(o.date === today() ? o : {}), date: today(), ...(parsed.what !== 'home' ? { gym: h } : {}), ...(parsed.what !== 'gym' ? { home: h } : {}) };
      await writeDoc('nudge_override', next);
      return send(chat, `⏰ Got it: ${parsed.what === 'home' ? 'home session' : parsed.what === 'gym' ? 'gym session' : 'the session'} at ~${h}:00.`);
    }
    default: {
      if (parsed.kind === 'note' && BARE_DONE.test(text.trim())) return whichDone(chat);
      if (parsed.kind === 'note' && entries.length === 1 && text.length > 3) {
        const id = Date.now().toString(36);
        await writeDoc(`pending_${id}`, { text });
        return send(chat, '🤔 Not sure how to log that. Is it…', { markup: buttons([[['🍽 Food', `u:food:${id}`], ['🏋️ Workout', `u:workout:${id}`], ['📝 Just a note', `u:note:${id}`]]]) });
      }
      await addEvent('note', { text: parsed.text || text });
      return react(chat, msg.message_id, '✍');
    }
  }
  }
}

// Button taps.
async function handleCallback(cq) {
  const chat = cq.message?.chat?.id, mid = cq.message?.message_id;
  if (!chat || (await getOwner()) !== chat) return answer(cq.id);
  if (!(await markSeen(`cb_${cq.id}`))) return;
  const [k, a, b] = String(cq.data || '').split(':');
  const t = today();

  if (k === 'x') { // undo a log (workout or steps) from its own message
    const path = String(cq.data).slice(2), ev = await recentEvents(), e = ev.find(x => x._path === path);
    if (!e) { await answer(cq.id, 'Already gone'); return editButtons(chat, mid, null); }
    await misread(`${e.type}_undo`, e.type === 'workout' ? (e.exercises || []).map(x => x.name).join(', ') : e.steps);
    await deleteByPath(path);
    if (e.type === 'workout') { await syncSteps(e.date); for (const d of ev.filter(x => x.type === 'day_target' && x.source === 'same_day' && x.ts >= e.ts)) await deleteByPath(d._path); }
    await answer(cq.id, 'Undone'); await edit(chat, mid, `↩️ <s>${esc(cq.message?.text?.split('\n')[0] || 'Entry')}</s> undone.`, { inline_keyboard: [] });
    return pinUpdate(chat);
  }
  if (k === 'q') { // one-tap usual meal
    const src = (await recentEvents()).find(e => e.type === 'food' && String(e.ts) === a);
    await answer(cq.id, src ? 'Logged' : 'Not found');
    if (!src) return;
    await editButtons(chat, mid, null);
    const { _path, ts, date, msg_id, tip_shown, ...food } = src;
    return logFood(chat, { ...food, cheat: false });
  }
  if (k === 'k') { // week commit: toggle a day, or lock it in
    const draft = (await readDoc('commit_draft')) || commitDraft(await recentEvents(), weekStart(t), t);
    if (a === 'ok') {
      await addEvent('week_commit', { week_start: draft.week_start, days: [...draft.days].sort() });
      await answer(cq.id, 'Locked in');
      await edit(chat, mid, commitText(draft, true), { inline_keyboard: [] });
      return pinUpdate(chat);
    }
    draft.days = draft.days.includes(a) ? draft.days.filter(d => d !== a) : [...draft.days, a].sort();
    await writeDoc('commit_draft', draft);
    await answer(cq.id);
    return editButtons(chat, mid, commitButtons(draft));
  }
  if (k === 'c') { // check-in taps
    const field = { wood: 'wood', en: 'energy', kn: 'knee' }[a], value = field === 'wood' ? b === '1' : Number(b);
    await addEvent('recovery', { [field]: value, source: 'button' });
    const ev = await recentEvents(1), r = dayRecovery(ev, t);
    await answer(cq.id, 'Saved');
    await editButtons(chat, mid, checkinButtons(r));
    pinUpdate(chat);
    if (r.wood != null) waitUntil(afterCheckin(chat).catch(e => console.error(e)));
    return;
  }
  if (k === 'w') { // workout card
    const ev = await recentEvents(2), gym = dayPlan(ev, t), home = homeFor(t, ev);
    const plan = HOME_ORDER.includes(a) ? home : gym;
    if (b === undefined && a === undefined) return answer(cq.id);
    if (cq.data.startsWith('w:plan:')) {
      await answer(cq.id, 'Logging…'); await editButtons(chat, mid, null);
      const exercises = plan.exercises.flatMap(e => e.circuit ? e.circuit : [e]).map(e => ({ plan_id: e.id || e.plan_id || null, name: e.name, muscle: e.muscle || 'other', sets: [], strict: false, level: null, note: null }));
      return logWorkout(chat, { kind: 'workout', session: a, date: null, exercises }, `${a} done as planned (button)`);
    }
    if (cq.data.startsWith('w:chg:')) {
      await answer(cq.id);
      return sendRaw(chat, `✏️ <b>${esc(a)}: what changed from the plan?</b> Say it or type it, e.g. <i>dips 3×8, no negatives</i>. Everything you don't mention counts as done as planned.`,
        { markup: { force_reply: true, input_field_placeholder: 'dips 3x8, no negatives…' } });
    }
    if (cq.data.startsWith('w:skip:')) {
      await addEvent('workout_skip', { session: a });
      await answer(cq.id, 'Marked as skipped'); await editButtons(chat, mid, null);
      pinUpdate(chat);
      return send(chat, `⏭ ${esc(a)} skipped today. It stays next in the order.`);
    }
    if (cq.data.startsWith('w:home:')) {
      await answer(cq.id, 'Rebuilding for home…'); await editButtons(chat, mid, null);
      return placeFlow(chat, { kind: 'location', where: 'home', equipment: [], train_here: true, date: null, request: null });
    }
  }
  if (k === 's') { // picked a session for today
    await addEvent('session_choice', { key: a });
    await answer(cq.id, `${a} it is`); await editButtons(chat, mid, null);
    const ev = await recentEvents(2), plan = HOME_ORDER.includes(a) ? homeFor(t, ev) : dayPlan(ev, t);
    pinUpdate(chat);
    await asked('workout');
    return send(chat, sessionCard(ev, plan), { markup: workoutButtons(plan.key, !HOME_ORDER.includes(a)) });
  }
  if (k === 'p') { // show the picker
    const ev = await recentEvents(2);
    await answer(cq.id);
    return send(chat, '🔀 Which session today?', { markup: pickerButtons(dayPlan(ev, t).key) });
  }
  if (k === 'r') { // "done" = the morning routine
    await addEvent('routine', { routine: 'morning', raw: 'done (button)' });
    await answer(cq.id, 'Morning routine logged'); await editButtons(chat, mid, null);
    pinUpdate(chat);
    return send(chat, `🧘 Morning routine done · streak ${adherence(await recentEvents(1), 28).morningStreak} days`);
  }
  if (k === 'f') { // food log
    const ev = await recentEvents(1), entry = ev.find(e => e.type === 'food' && String(e.ts) === b);
    if (a === 'ok') { await answer(cq.id, '👌'); return editButtons(chat, mid, null); }
    if (a === 'fix') {
      await answer(cq.id); await misread('food_fix', (entry?.items || []).map(i => i.name).join(', '));
      if (entry) await writeDoc('fixing', { ts: entry.ts, at: Date.now() });
      return sendRaw(chat, `✏️ What's off with <b>${esc((entry?.items || []).map(i => i.name).slice(0, 3).join(', ') || 'that meal')}</b> (~${fmt(entry?.total?.kcal || 0)} kcal)? Say it or type it.`,
        { markup: { force_reply: true, input_field_placeholder: 'half the rice, no oil…' } });
    }
    if (a === 'undo') {
      if (!entry) return answer(cq.id, 'Already gone');
      await misread('food_undo', (entry.items || []).map(i => i.name).join(', '));
      await deleteByPath(entry._path);
      await answer(cq.id, 'Removed');
      await edit(chat, mid, `🗑 <s>Removed: ~${fmt(entry.total?.kcal || 0)} kcal (${esc(entry.meal || 'meal')})</s>`, { inline_keyboard: [] });
      return pinUpdate(chat);
    }
  }
  if (k === 'u') { // "not sure how to log that"
    const pending = await readDoc(`pending_${b}`);
    await answer(cq.id); await editButtons(chat, mid, null);
    if (!pending?.text) return;
    if (a === 'note') { await addEvent('note', { text: pending.text }); return send(chat, '📝 Kept as a note.'); }
    return handle({ chat: { id: chat }, message_id: mid, text: `${a === 'food' ? 'Food I ate' : 'Workout I did'}: ${pending.text}` });
  }
  return answer(cq.id);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(200).send('ok');
  if (req.headers['x-telegram-bot-api-secret-token'] !== process.env.WEBHOOK_SECRET) return res.status(401).send('no');
  if (req.body?.callback_query) {
    try { await handleCallback(req.body.callback_query); }
    catch (e) { console.error(e); await answer(req.body.callback_query.id, 'Something went wrong').catch(() => {}); }
    return res.status(200).send('ok');
  }
  const edited = !!req.body?.edited_message;
  const msg = req.body?.message || req.body?.edited_message;
  // Each message (and each edit) is handled once, even if Telegram re-sends it.
  if (msg && await markSeen(edited ? `e${msg.chat.id}_${msg.message_id}_${msg.edit_date}` : `m${msg.chat.id}_${msg.message_id}`)) {
    try { await handle(msg, { edited }); }
    catch (e) { console.error(e); await send(msg.chat.id, `Error: ${String(e.message).slice(0, 200)}`).catch(() => {}); }
  }
  res.status(200).send('ok');
}
