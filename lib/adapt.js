// Adaptive plan: when a workout deviates from the plan (or on /adjust / Sunday flags),
// ask Claude to re-plan the next 6 days, store it, and use it for the daily cards.
import { ask } from './claude.js';
import { ADAPT } from './schemas.js';
import { addEvent } from './store.js';
import { today } from './config.js';
import { sessionFor, PARSER_CATALOG } from './plan.js';
import { fmtSets, setsPerMuscle } from './training.js';
import { getProfile } from './persona.js';

const day = n => today(new Date(Date.now() + n * 864e5));
const wd = d => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });

// Latest adapted plan covering `date` (made in the last 7 days), else the default plan.
export function dayPlan(events, date = today()) {
  if ((events || []).some(e => e.type === 'session_choice' && e.date === date && /^[ABCD]$/.test(e.key) && !e.place)) {
    const s = sessionFor(date, events);
    return { key: s.key, name: s.name, reason: null, block: s.block, adapted: false, warmup: s.warmup, dayType: true, exercises: s.exercises, chosen: true };
  }
  const plans = events.filter(e => e.type === 'week_plan' && e.ts > Date.now() - 7 * 864e5).sort((a, b) => b.ts - a.ts);
  for (const p of plans) {
    const d = (p.days || []).find(x => x.date === date);
    if (d) return { key: d.key || p.key || sessionFor(date, events).key, name: d.name, reason: d.changed ? d.reason : null, block: sessionFor(date, events).block, adapted: true, warmup: null, dayType: true, kind: p.where ? 'home' : 'gym',
      exercises: d.exercises.map(e => ({ ...e, id: e.plan_id || null })) };
  }
  const s = sessionFor(date, events);
  return { key: s.key, name: s.name, reason: null, block: s.block, adapted: false, warmup: s.warmup, dayType: s.dayType, exercises: s.exercises };
}

export async function adaptWeek(events, flags, why) {
  const recent = events.filter(e => e.type === 'workout' && e.date >= day(-6) && e.session !== 'morning')
    .map(e => `${e.date} (${wd(e.date)}): ` + (e.exercises || []).map(x => `${x.name}${x.plan_id ? ` [${x.plan_id}]` : ''} ${fmtSets(x)}`).join('; '));
  const upcoming = Array.from({ length: 6 }, (_, i) => day(i + 1)).filter(d => dayPlan(events, d).dayType).map(d => {
    const p = dayPlan(events, d);
    return `${d} (${wd(d)})${p.block ? ` [${p.block.name}${p.block.note ? ': ' + p.block.note : ''}]` : ''}: ${p.name} — ` +
      p.exercises.map(e => `${e.id || e.plan_id || 'custom'}: ${e.name} ${e.target}`).join('; ');
  });
  const out = await ask({
    system: `You adjust a training week for a 38-year-old man: recomp cut, calisthenics skills (muscle-up, front lever, handstand, L-sit), weighted pull-ups/dips, ski prep for late December. Gym sessions run in order A (push + muscle-up) → B (lower + glutes) → C (pull + front lever + arms) → D (full body + 4×4), 4–5 a week; home sessions H1 (skills + core) → H2 (legs, ski + kicks) → H3 (grip + conditioning) on 3–5 afternoons; walks daily, two as rucks. Rules: a day between B and H2; never stack two hard sessions to catch up. Knee pain rule: keep pain ≤3/10.
Re-plan the next 6 days so the week still works after what he actually did:
- Leave ~48 h before training the same muscle group hard again; if he already trained what is planned soon, swap or lighten that day.
- Keep weekly volume balanced (~10–20 hard sets per big muscle group), keep skill practice, keep one rest or easy day.
- Respect block notes (taper/deload = fewer sets). If load flags are given, address them.
- Change only what needs changing; unchanged days keep the planned exercises. Prefer catalog exercises with their plan_id; use plan_id null for anything else.
- cue: only for exercises people commonly do wrong or get hurt on, the one mistake to avoid in ≤ 7 words; otherwise an empty string.
- target is short, like "4 × 5", "3 × 8/side", "5 × 10–15 s". reason ≤ 12 words. summary ≤ 2 sentences, written to him like a coach texting a friend (plain text, no markup).
What you know about him: ${(await getProfile()).notes.join(' ')}`,
    content: `Today: ${today()} (${wd(today())}). Why re-plan: ${why}\n\nLast 7 days logged:\n${recent.join('\n') || 'nothing logged'}\n\nSets per muscle, 7 days: ${JSON.stringify(setsPerMuscle(events, 7))}\n\nLoad flags: ${flags.length ? flags.join(' | ') : 'none'}\n\nPlanned next 6 days:\n${upcoming.join('\n')}\n\nCatalog (plan_id: name):\n${PARSER_CATALOG}`,
    maxTokens: 12000, schema: ADAPT, effort: 'medium'
  });
  await addEvent('week_plan', { ...out, why });
  return out;
}

export function adaptMessage(out) {
  const changed = (out.days || []).filter(d => d.changed);
  const lines = [`🔄 <b>Plan adjusted</b>\n${out.summary}`];
  changed.forEach(d => lines.push(`\n<b>${wd(d.date)} ${d.date.slice(8)}: ${d.name}</b>\n<i>${d.reason}</i>\n` + d.exercises.map(e => `• ${e.name} — ${e.target}${e.cue ? ` · <i>${e.cue}</i>` : ''}`).join('\n')));
  if (!changed.length) lines.push('\nNo changes needed: the rest of the week stays as planned.');
  else lines.push('\nOther days stay as planned. /plan shows today, /adjust re-plans.');
  return lines.join('\n');
}
