// Nightly self-improvement loop (≈23:30 Cairo, silent). Reviews logs, history, recovery, weight, new progress
// photos and the programme, then makes bounded adjustments to the coming week's workouts, the morning routine and
// the calorie-cycling numbers. The goals in the programme doc are fixed. Every change is logged with its reason
// (`coach_log`), so the coach can explain it when asked.
import { allEvents, allMeasurements, addEvent, listPhotos } from './store.js';
import { allMeas, weekStats, dayFood } from './summary.js';
import { daysVsPlan } from './plandiff.js';
import { ask } from './claude.js';
import { IMPROVE } from './schemas.js';
import { CONFIG, today, currentPhase } from './config.js';
import { MILESTONES, LADDERS, homeFor, PARSER_CATALOG, programmeCoverage } from './plan.js';
import { dayPlan } from './adapt.js';
import { fmtSets, ladderProgress, adherence, setsPerMuscle } from './training.js';
import { recoverySummary, recoveryFlags } from './recovery.js';
import { loadFlags } from './load.js';
import { foodHabits } from './habits.js';
import { todayTarget } from './diet.js';
import { currentRoutine } from './templates.js';
import { compareProgress } from './progress.js';
import { getProfile, personaPrompt } from './persona.js';

const shift = (d, n) => new Date(new Date(`${d}T12:00:00Z`).getTime() + n * 864e5).toISOString().slice(0, 10);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export async function nightlyImprove({ dry = false } = {}) {
  const ev = await allEvents(), meas = allMeas(await allMeasurements()), t = today(), ph = currentPhase(t);
  const since = shift(t, -13);
  const workouts = ev.filter(e => e.type === 'workout' && e.date >= since).map(e => `${e.date} ${e.session}${e.place ? ` (${e.place})` : ''}: ${(e.exercises || []).map(x => `${x.name} ${fmtSets(x)}${x.note ? ` [${x.note}]` : ''}`).join('; ')}`);
  const vsPlan = daysVsPlan(ev, since).map(d => `${d.date} ${d.session}: ${d.missed.length ? `MISSED ${d.missed.join(', ')}` : 'nothing missed'}${d.swaps.length ? ` | swapped: ${d.swaps.map(w => `${w[1]} for ${w[0]}`).join(', ')}` : ''}${d.added.length ? ` | extra: ${d.added.join(', ')}` : ''}`);
  const skipped = ev.filter(e => e.type === 'workout_skip' && e.date >= since).map(e => `${e.date} ${e.session}`);
  const upcoming = Array.from({ length: 7 }, (_, i) => shift(t, i + 1)).map(d => {
    const g = dayPlan(ev, d), h = homeFor(d, ev);
    return { date: d, gym: g.dayType === true ? { key: g.key, name: g.name, exercises: g.exercises.map(e => `${e.id || e.plan_id || 'custom'}: ${e.name} ${e.target}`) } : null, home: h.dayType === true ? h.name : null };
  });
  const tt = todayTarget(ev), tomorrow = shift(t, 1), tm = todayTarget(ev, tomorrow);
  const kcalBounds = ph.cycling ? [Math.max(1300, tm.cycling ? ph.cycling.low - 200 : 1300), Math.min(3000, ph.cycling.high + 200)] : null;
  const calories = ph.cycling ? {
    today: { date: t, type: tt.type, target: tt.kcal, eaten: dayFood(ev, t).kcal, why: tt.reason },
    tomorrow: { date: tomorrow, type: tm.type, target: tm.kcal, why: tm.reason, feast: tm.type === 'feast' },
    week: { budget: tt.weekBudget, usedBeforeToday: tt.weekUsed, highsUsed: tt.highsUsed, highsAllowed: tt.highsAllowed }, tomorrowBounds: kcalBounds
  } : null;
  const steps7 = Object.entries(ev.filter(e => e.type === 'steps' && e.date >= shift(t, -6)).reduce((m, e) => ({ ...m, [e.date]: e.steps }), {})).map(([d, n]) => `${d} ${n}`);
  const prior = ev.filter(e => e.type === 'coach_log').slice(-3).map(e => `${e.date}: ${e.summary}`);
  // New progress photos since the last loop → one comparison (vision) for context.
  const lastLoop = ev.filter(e => e.type === 'coach_log').pop()?.ts || 0;
  const newPhotos = ev.filter(e => e.type === 'photo' && e.ts > lastLoop).length;
  const photoRead = newPhotos && (await listPhotos()).length ? await compareProgress(ev, meas).catch(() => null) : null;

  const context = {
    FIXED_GOALS: { targets: CONFIG.targets, floors: CONFIG.floors, milestones: MILESTONES, skillTargets: LADDERS.map(l => `${l.name}: ${l.target ?? 'progress'}`), phases: CONFIG.phases.map(p => `${p.name} ${p.from}→${p.to}`) },
    phaseNow: ph.name, calories, cyclingNow: ph.cycling ? { low: tt.cycling ? (ph.cycling.low) : null, high: ph.cycling.high, protein: ph.protein } : null,
    last14days: { food: weekStats(ev, meas, 14), workouts, vsPlan, skipped, steps7, adherence: adherence(ev, 14), setsPerMuscle7: setsPerMuscle(ev, 7), ladders: ladderProgress(ev).map(({ key, best, target }) => ({ key, best, target })) },
    recovery: { summary: recoverySummary(ev), flags: recoveryFlags(ev) }, loadFlags: loadFlags(ev, meas),
    weights: meas.filter(m => m.weight && m.date >= shift(t, -21)).map(m => `${m.date} ${m.weight}`), tape: meas.filter(m => m.waist).slice(-3),
    eatingPatterns: (({ staples, occasional, loggedDays }) => ({ loggedDays, staples: staples.map(s => s.name), occasional: occasional.map(s => s.name) }))(foodHabits(ev, 14)),
    morningRoutine: currentRoutine(ev).map(e => `${e.id || 'custom'}: ${e.name} ${e.target}`),
    upcoming7days: upcoming, weeklyCoverage: programmeCoverage(), photoRead, priorNightlyNotes: prior
  };
  const out = await ask({
    system: `${personaPrompt(await getProfile(), ev)}
You are running the nightly review of his programme. Look at what actually happened (adherence, loads, skipped work, recovery, weight and waist trend, food), then make SMALL, evidence-based adjustments that move him toward the FIXED_GOALS. The goals, milestones and skill targets never change; everything else may be tuned. Rules:
- Change only what the evidence supports; no change is a valid answer. Don't flip-flop against priorNightlyNotes without new evidence.
- workout_days: only dates in upcoming7days that have a gym session; keep that session's purpose and muscle groups (the session letter and order stay), adjust exercises, sets, reps, holds or progressions (e.g. add a rep, swap a stalled lift, deload a recovering area, add a missed skill). Each day's full exercise list. plan_id from the catalog where the movement exists. cue: only for error-prone moves, ≤ 7 words, else "".
- vsPlan (per trained day: MISSED / swapped / extra versus that day's plan) drives the next sessions: put missed key work (a main lift, the 4×4 intervals, carries, a skill) into the next suitable gym day in upcoming7days if recovery allows, by swapping or trimming something lower-value, never by stacking two hard sessions; drop it rather than overload. A treadmill or walk at normal pace is easy cardio, not intervals.
- tomorrow_kcal: tomorrow's calorie target, set from what actually happened (calories, vsPlan, steps7, today's intake): e.g. a high day whose hard work (intervals, heavy legs) was missed earned less, so the week has less room; hard extra conditioning or a big training day tomorrow can earn more. Stay within tomorrowBounds, keep the week near its budget, never on a feast day. change=false when the default fits.
- routine: the 20-minute morning routine; change it only for a reason (stiffness, knee, a lagging hold). Keep the tracked holds (dead_hang, wall_sit, hs_wall, hs_free ids) and 20 minutes. If unchanged, change=false and items [].
- diet: only during calorie cycling; low_kcal 1300–1800, high_kcal 2400–3000, protein_g 170–210; change only on clear evidence (weight dropping > 1 kg/week, stalled waist for 2+ weeks, recovery stop signs, protein consistently missed). If unchanged, change=false and nulls.
- focus: one line for tomorrow, in his voice-friendly style (≤ 14 words).
- rationale: one entry per change (what changed, why, citing the data). summary: 2 sentences for your own log.`,
    content: `${JSON.stringify(context)}\n\nCatalog (plan_id: name):\n${PARSER_CATALOG}`,
    maxTokens: 16000, schema: IMPROVE, effort: 'medium', model: CONFIG.reviewModel, tag: 'nightly'
  });

  // Apply with guardrails.
  const applied = { workout: 0, routine: false, diet: false };
  const validDays = new Map(upcoming.filter(u => u.gym).map(u => [u.date, u.gym]));
  const days = (out.workout_days || []).filter(d => validDays.has(d.date) && d.exercises?.length >= 3 && d.exercises.length <= 12)
    .map(d => ({ date: d.date, changed: true, key: validDays.get(d.date).key, name: validDays.get(d.date).name, reason: d.reason, exercises: d.exercises }));
  if (!dry && days.length) { await addEvent('week_plan', { summary: out.summary, days, why: 'nightly review', source: 'nightly' }); applied.workout = days.length; }
  const items = out.routine?.items || [];
  if (!dry && out.routine?.change && items.length >= 6 && items.length <= 14) { await addEvent('routine_plan', { items, why: out.routine.reason }); applied.routine = true; }
  if (!dry && out.diet?.change && ph.cycling) {
    const tweak = { low: out.diet.low_kcal != null ? clamp(out.diet.low_kcal, 1300, 1800) : null, high: out.diet.high_kcal != null ? clamp(out.diet.high_kcal, 2400, 3000) : null,
      protein: out.diet.protein_g != null ? clamp(out.diet.protein_g, 170, 210) : null, why: out.diet.reason };
    if (tweak.low || tweak.high || tweak.protein) { await addEvent('diet_tweak', tweak); applied.diet = true; }
  }
  const tk = out.tomorrow_kcal;
  if (!dry && kcalBounds && tk?.change && tk.kcal != null && !calories.tomorrow.feast) {
    await addEvent('day_target', { target_date: tomorrow, kcal: clamp(Math.round(tk.kcal / 50) * 50, ...kcalBounds), why: tk.reason }); applied.kcal = true;
  }
  if (!dry) await addEvent('coach_log', { summary: out.summary, focus: out.focus, rationale: out.rationale || [], applied });
  return { ...out, applied };
}
