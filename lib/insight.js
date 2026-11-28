// Morning insight: one Claude call a day that turns yesterday and last night into a caution,
// encouragement or strategy for today, in the coach's voice.
import { ask } from './claude.js';
import { getProfile, personaPrompt } from './persona.js';
import { dayFood } from './summary.js';
import { todayTarget } from './diet.js';
import { recoverySummary, recoveryFlags, dayRecovery } from './recovery.js';
import { loadFlags } from './load.js';
import { dayPlan } from './adapt.js';
import { homeFor, walkFor, MILESTONES } from './plan.js';
import { fmtSets } from './training.js';
import { today } from './config.js';

const shift = (d, n) => new Date(new Date(`${d}T12:00:00Z`).getTime() + n * 864e5).toISOString().slice(0, 10);

export async function morningInsight(events) {
  const t = today(), y = shift(t, -1);
  const fy = dayFood(events, y), ty = todayTarget(events, y), tt = todayTarget(events, t);
  const gym = dayPlan(events, t), home = homeFor(t, events);
  const yesterday = {
    food: { kcal: fy.kcal, protein: fy.protein, target: ty.kcal, dayType: ty.type, meals: fy.meals, feast: events.some(e => e.type === 'food' && e.cheat && e.date === y) },
    training: events.filter(e => e.type === 'workout' && e.date === y).map(e => `${e.session}: ${(e.exercises || []).map(x => `${x.name} ${fmtSets(x)}`).join('; ')}`),
    steps: events.filter(e => e.type === 'steps' && e.date === y).map(e => e.steps).pop() ?? null,
    recovery: dayRecovery(events, y),
    eveningChat: events.filter(e => e.type === 'chat' && e.date === y).slice(-4).map(e => `Him: ${e.q} | You: ${e.a.slice(0, 300)}`),
    notes: events.filter(e => e.type === 'note' && e.date === y).map(e => e.text)
  };
  const todayPlan = {
    gym: gym.dayType ? `${gym.name}${gym.dayType === 'optional' ? ' (optional)' : ''}` : 'no gym', home: home.dayType ? home.name : 'none', walk: walkFor(t),
    food: { kcal: tt.kcal, type: tt.type, reason: tt.reason }, block: gym.block?.name || null,
    milestoneSoon: MILESTONES.find(m => m.date >= t && m.date <= shift(t, 3)) || null
  };
  const text = await ask({
    system: `${personaPrompt(await getProfile(), events)}
Write the opening of his morning message: 2–3 short lines, at most 60 words. First, one insight from yesterday or last night that matters today: a caution (recovery, over budget, knee, a missed protein target), encouragement (a PR, a clean day, a streak), or a strategy (how to handle today's low/high day, a feast, a hard session). Then one concrete focus for today. No greeting, no sign-off, don't list numbers he'll see below, never invent data.`,
    content: JSON.stringify({ yesterday, today: todayPlan, recovery3d: recoverySummary(events), recoveryFlags: recoveryFlags(events), loadFlags: loadFlags(events, [], { body: false }) }),
    maxTokens: 3000, effort: 'low', tag: 'recap'
  });
  return text.trim();
}

// Evening recap: how today went, one thing that worked, one adjustment, tomorrow's first move.
export async function eveningRecap(events, { habit = null } = {}) {
  const t = today(), f = dayFood(events, t), tt = todayTarget(events, t), tm = shift(t, 1);
  const gym = dayPlan(events, tm), home = homeFor(tm, events), t2 = todayTarget(events, tm);
  const day = {
    food: { kcal: f.kcal, protein: f.protein, target: tt.kcal, proteinTarget: tt.protein, dayType: tt.type, meals: f.meals,
      items: events.filter(e => e.type === 'food' && e.date === t).flatMap(e => (e.items || []).map(i => `${i.name} ${i.kcal}`)).slice(0, 20) },
    training: events.filter(e => e.type === 'workout' && e.date === t).map(e => `${e.session}: ${(e.exercises || []).map(x => `${x.name} ${fmtSets(x)}`).join('; ')}`),
    skipped: events.filter(e => e.type === 'workout_skip' && e.date === t).map(e => e.session),
    steps: events.filter(e => e.type === 'steps' && e.date === t).map(e => e.steps).pop() ?? null,
    recovery: dayRecovery(events, t), chatToday: events.filter(e => e.type === 'chat' && e.date === t).slice(-3).map(e => e.q)
  };
  const tomorrow = { gym: gym.dayType ? `${gym.name}${gym.dayType === 'optional' ? ' (optional)' : ''}` : 'rest day from the gym', home: home.dayType ? home.name : 'none', food: `${t2.type} day, ${t2.kcal} kcal`, walk: walkFor(tm) };
  const text = await ask({
    system: `${personaPrompt(await getProfile(), events)}
Write his end-of-day recap: 3–4 short lines, at most 70 words. 1) How today went, specific to his numbers (not a list of them). 2) One thing that worked. 3) One thing to adjust. 4) Tomorrow's first move (pre-decided, concrete). ${habit?.onboarding ? `He is on day ${habit.day} of building the habit: if he logged today, acknowledge it warmly in a few words; if he missed something, "never miss twice", no guilt.` : ''} It's late: never suggest eating or training more tonight unless protein is far short (then one easy protein option). Never invent data.`,
    content: JSON.stringify({ today: day, tomorrow, habit, recovery3d: recoverySummary(events), flags: recoveryFlags(events) }),
    maxTokens: 3000, effort: 'low', tag: 'recap'
  });
  return text.trim();
}
