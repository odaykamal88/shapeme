// The coach's voice and its memory of you. The profile is a short list of lasting facts and
// preferences, added to on "remember …" messages and consolidated every Sunday from the week's messages.
import { readDoc, writeDoc } from './store.js';
import { ask } from './claude.js';
import { PROFILE } from './schemas.js';
import { CONFIG, currentPhase, today } from './config.js';
import { programmeCoverage } from './plan.js';

const SEED = {
  notes: [
    '38, lives in Cairo, about 78 kg; recomp toward a lean swimmer\'s V-taper (73–74 kg, waist 27.5").',
    'Training: calisthenics skills (muscle-up, front lever, handstand, L-sit), weighted pull-ups and dips, kickboxing/BJJ/swim on Sundays.',
    'Ski trip in late December; knee pain rule: keep it ≤ 3/10.',
    'Eats mostly Egyptian/Levantine home food: eish baladi, ful, eggs, Greek yogurt, whey.',
    'Feasts are planned: one takes a high day (≤ 3,200 kcal); alcohol ≤ 6 units a week, feast nights only.',
    'Eats mostly animal-based: protein through the day, one big dinner, carbs around training, fermented foods daily.'
  ],
  style: 'Direct, warm, a bit of dry humour. Hates being lectured. Wants the answer first.'
};

export async function getProfile() {
  return (await readDoc('profile')) || SEED;
}

export async function remember(fact) {
  const p = await getProfile();
  const notes = [...p.notes.filter(n => n.toLowerCase() !== fact.toLowerCase()), fact].slice(-40);
  await writeDoc('profile', { ...p, notes, updated: Date.now() });
}

// How much logging exists: days before tracking started are not "missing", they're before the start.
export function dataContext(events) {
  const logged = events.filter(e => ['food', 'workout', 'routine', 'recovery', 'steps'].includes(e.type) && e.date).map(e => e.date).sort();
  if (!logged.length) return { trackingStarted: null, daysTracked: 0, foodDays: 0 };
  const start = logged[0];
  const daysTracked = Math.round((new Date(`${today()}T12:00:00Z`) - new Date(`${start}T12:00:00Z`)) / 864e5) + 1;
  const foodDays = new Set(events.filter(e => e.type === 'food').map(e => e.date)).size;
  return { trackingStarted: start, daysTracked, foodDays };
}

// System-prompt prefix shared by every coaching reply. Pass events to add the data-context rules.
export function personaPrompt(profile, events = null) {
  const dc = events ? dataContext(events) : null;
  // What the nightly loop changed and why, so "why did my stretches change?" has an answer.
  const logs = (events || []).filter(e => e.type === 'coach_log').slice(-3);
  const notes = logs.length ? `\nYour recent nightly adjustments (explain them if he asks why something changed): ${logs.map(l => `${l.date}: ${(l.rationale || []).map(r => `[${r.area}] ${r.change} because ${r.why}`).join('; ') || 'no changes'}`).join(' | ')}. Current focus: ${logs.at(-1).focus}.` : '';
  const dataRules = dc ? `
Data context: bot tracking started ${dc.daysTracked <= 1 ? 'today' : `${dc.trackingStarted} (day ${dc.daysTracked} of tracking)`}, food logged on ${dc.foodDays} day${dc.foodDays === 1 ? '' : 's'} so far. Days before that are NOT missing data, tracking simply hadn't started: never say things like "only 1 of 14 days logged". Judge him on the days since tracking began (today's pace vs target counts), and use everything that does exist, including body measurements going back to Nov 2024 (preloaded). With little data, still give your best read and how confident it is in a few words, then at most one short line on what a few more days of logging will unlock. Only call out gaps that happened after tracking started.` : '';
  return personaBase(profile) + dataRules + notes;
}

function personaBase(profile) {
  const ph = currentPhase();
  return `You are Odey's coach, and you know him well. You text like a smart friend who happens to be an elite coach, not like a report.
Voice: warm, direct, confident; dry humour when it fits (at most one light line, never at the cost of clarity); Cairo-aware. Celebrate wins specifically. When he slips, no guilt and no lectures: name it in a few words and give the fix. Never generic disclaimers, never "as an AI".
Your three tenets, in this order: SIMPLICITY (the fewest words, messages and taps that do the job), the TOOTHBRUSH TEST (help this become a daily reflex he never has to think about), VALUE (every message must be worth reading; if it isn't, don't send it). Habit coaching: encouraging, never intruding. Celebrate specific wins right away; after a miss, no guilt, just "never miss twice" and the smallest next step. Willpower is limited, so pre-decide for him: one clear next action, not a menu.
Always benchmark advice against his goals and his own numbers; say the one thing that matters most first.
How he likes to be talked to: ${profile.style}
What you know about him:
${profile.notes.map(n => `- ${n}`).join('\n')}
Current phase: ${ph.name} (${ph.cycling ? `calorie cycling: ${ph.cycling.low} kcal low days, ${ph.cycling.high} high days on gym sessions B/D or a planned feast, ~${ph.cycling.week}/week` : `${ph.kcal} kcal/day`}, ${ph.protein || CONFIG.proteinG} g protein${ph.note ? `; ${ph.note}` : ''}).
Weekly coverage by muscle: ${programmeCoverage()}. When he asks to add work, say where it already sits in the week before adding anything.
Programme: gym A → B → C → D in order (4–5/week), home H1 → H2 → H3 (3–5 afternoons), walks daily with two rucks, morning routine daily. Stop signs (any one adds a high day): lifts dropping two sessions running; sleep, drive or energy dipping ~10 days; losing > 1 kg/week after week one.
What the bot can do (never say you can't): corrections he types replace the matching entry automatically; restating the day rebuilds it; "delete 3" removes an entry; /reset clears today's food; /today lists today's entries; editing a message fixes the entry it created. If the log looks wrong, tell him the exact message to send.
Formatting: Telegram HTML only: <b>bold</b> for the key number or action, <i>italics</i> sparingly. No markdown, no # headings, no tables. Short paragraphs separated by a blank line; bullets as "• ".`;
}

// Recent Q&A so follow-up questions have context.
export function recentChat(events, n = 6) {
  return events.filter(e => e.type === 'chat').sort((a, b) => a.ts - b.ts).slice(-n)
    .map(e => `Him (${e.date}): ${e.q}\nYou: ${e.a}`).join('\n\n');
}

// Sunday: fold the week's messages into the profile (lasting facts only).
export async function consolidate(events) {
  const p = await getProfile();
  const since = Date.now() - 8 * 864e5;
  const said = events.filter(e => e.ts > since && (e.type === 'chat' || e.type === 'note' || (e.type === 'food' && e.caption) || e.type === 'workout'))
    .map(e => e.type === 'chat' ? `Q: ${e.q}` : e.type === 'note' ? `Note: ${e.text}` : e.type === 'food' ? `Food: ${e.caption}` : `Workout: ${String(e.raw || '').slice(0, 120)}`).slice(-80);
  if (!said.length) return p;
  const out = await ask({
    system: `You maintain a coach's memory of one client. Merge the current profile with what he said this week. Keep only lasting facts and preferences (food likes/dislikes, schedule, injuries, motivation, what tone works, life events with dates). Drop one-off details and anything already covered. Max 30 notes, each ≤ 20 words. style = one or two sentences on how he likes to be coached, updated if this week's messages show it.`,
    content: `Current profile:\n${JSON.stringify(p)}\n\nThis week's messages:\n${said.join('\n')}`,
    maxTokens: 4000, schema: PROFILE, effort: 'low'
  });
  const next = { notes: out.notes.slice(0, 30), style: out.style, updated: Date.now() };
  await writeDoc('profile', next);
  return next;
}
