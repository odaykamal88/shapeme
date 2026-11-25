// The training plan from "Training Schedule — Cut, Skills & Ski Prep" (v2), as data.
// Gym sessions run in a fixed ORDER (A → B → C → D) and home sessions too (H1 → H2 → H3): miss a day and the
// next one in the order is simply next. The sample week only decides which days are gym / home / ruck days.
// `track` marks exercises whose best result feeds a skill ladder or progression chart. Keep ids stable: logged
// history, "last time" numbers and charts are keyed by them.
import { today } from './config.js';

const ex = (id, name, muscle, target, extra = {}) => ({ id, name, muscle, target, ...extra });

export const MORNING = [
  ex('cat_cow', 'Cat/cow', 'mobility', '8 slow reps'),
  ex('cobra', 'Cobra', 'mobility', '3 × 5 breaths'),
  ex('down_dog', 'Downward dog, pedalling the heels', 'mobility', '45 s'),
  ex('arm_throws', 'Arm throws + spine openers', 'mobility', '1 min'),
  ex('thread_needle', 'Thread-the-needle / open-book', 'mobility', '5/side'),
  ex('dead_hang', 'Dead hang on the home bar', 'forearms', '1 × max (pull days: ~10 s short of max)', { track: 'dead_hang' }),
  ex('wall_sit', 'Wall sit', 'legs', '1 hold, +15 s/week up to 2 min', { track: 'wall_sit' }),
  ex('lunge_hold', 'Held partial lunge, knee off the floor', 'legs', '1 hold/leg, +10 s/week'),
  ex('hs_wall', 'Chest-to-wall handstand', 'shoulders', '3 × 30–45 s', { track: 'hs_wall' }),
  ex('hs_free', 'Kick-ups away from the wall', 'shoulders', '3 min, log best freestanding hold', { track: 'hs_free' }),
  ex('fold_hang', 'Forward-fold hang', 'mobility', '2 × 30 s (last on purpose)'),
  ex('vacuum', 'Standing stomach vacuum', 'core', '3 × 20 s')
];

export const WARMUPS = {
  upper: 'Jump rope 2 min · band dislocates × 10 · band pull-aparts × 20 · scapular pull-ups × 8 · 2 light sets of the first lift',
  lower: 'Jump rope 2 min · 90/90 switches × 10 · Cossack squat × 6/side · single-leg RDL 2 × 8/leg · 2 light sets of the first lift'
};

export const SESSIONS = {
  A: {
    name: 'A — Push + muscle-up', warmup: 'upper', kind: 'gym',
    exercises: [
      ex('ctb_pullup', 'Explosive chest-to-bar pull-ups', 'back', '5 × 3', { track: 'ctb' }),
      ex('mu_negative', 'Muscle-up negatives, then band-assisted', 'back', '3 × 2', { track: 'muscle_up' }),
      ex('dip_weighted', 'Weighted dips (belt)', 'chest', '4 × 5–6', { track: 'dip_weighted', repsTop: 6, inc: 2.5 }),
      ex('incline_db', 'Incline dumbbell press', 'chest', '3 × 8', { repsTop: 8, inc: 2 }),
      ex('crossover', 'Superset: cable crossover high-to-low', 'chest', '3 × 12–15'),
      ex('lateral_raise', '+ cable lateral raise', 'shoulders', '3 × 12–15'),
      ex('oh_tri_ext', 'Superset: overhead cable extension', 'arms', '3 × 10–12', { repsTop: 12, inc: 2.5 }),
      ex('rope_pushdown', '+ heavy rope pushdown', 'arms', '3 × 10–12', { repsTop: 12, inc: 2.5 })
    ]
  },
  B: {
    name: 'B — Lower + glutes', warmup: 'lower', kind: 'gym', legs: true,
    exercises: [
      ex('rdl', 'Romanian / trap-bar deadlift', 'legs', '4 × 5', { repsTop: 5, inc: 5 }),
      ex('hip_thrust', 'Barbell hip thrust', 'legs', '3 × 8–10', { repsTop: 10, inc: 5 }),
      ex('bulgarian', 'Bulgarian split squat', 'legs', '3 × 6–8/leg', { repsTop: 8, inc: 2 }),
      ex('spanish_squat', 'Spanish squat hold', 'legs', '3 × 45 s'),
      ex('slider_ham_curl', 'Slider hamstring curl', 'legs', '3 × 8'),
      ex('calf_raise', 'Slow calf raise', 'legs', '3 × 12')
    ]
  },
  C: {
    name: 'C — Pull + front lever + arms', warmup: 'upper', kind: 'gym',
    exercises: [
      ex('fl_tuck', 'Front lever tuck hold', 'back', '5 × 10–15 s', { track: 'fl_tuck', levelTracks: { advanced_tuck: 'front_lever', one_leg: 'front_lever', straddle: 'front_lever', full: 'front_lever' } }),
      ex('pullup_weighted', 'Weighted pull-ups (belt)', 'back', '4 × 5', { track: 'pullup_weighted', repsTop: 5, inc: 2.5 }),
      ex('db_row', 'One-arm dumbbell row', 'back', '3 × 8/side', { repsTop: 8, inc: 2 }),
      ex('straight_arm_pd', 'Superset: straight-arm pulldown', 'back', '3 × 12'),
      ex('rear_delt_fly', '+ rear-delt cable fly', 'shoulders', '3 × 15'),
      ex('lean_lateral', 'Dumbbell lateral raise, lean-away', 'shoulders', '3 × 15–20'),
      ex('incline_curl', 'Superset: incline curl', 'arms', '3 × 10'),
      ex('hammer_curl', '+ heavy hammer curl', 'arms', '3 × 8', { track: 'hammer_curl', repsTop: 8, inc: 2 }),
      ex('reverse_curl', 'Superset: reverse EZ-bar curl', 'forearms', '3 × 12'),
      ex('wrist_curl', '+ behind-the-back wrist curl', 'forearms', '3 × 15')
    ]
  },
  D: {
    name: 'D — Full body + conditioning', warmup: 'upper', kind: 'gym',
    exercises: [
      ex('lsit', 'L-sit on parallettes', 'core', '4 × max hold', { track: 'lsit_tuck', levelTracks: { full: 'lsit' } }),
      { id: 'strength_trio', name: 'Strength trio (~80% of A/B/C weights, 2 min between rounds)', muscle: 'back', target: '3 rounds',
        circuit: [ex('trio_pullup', 'Weighted pull-up', 'back', '× 5'), ex('trio_dip', 'Weighted dip', 'chest', '× 6'), ex('trio_deadlift', 'Trap-bar deadlift', 'legs', '× 5')] },
      ex('intervals_4x4', '4×4 intervals (bike, rower or pool)', 'cardio', '4 × 4 min hard, 3 min easy'),
      ex('farmer_carry', 'Heavy farmer\'s carry', 'forearms', '3 × 40 m')
    ]
  },
  H1: {
    name: 'H1 — Skills + core', kind: 'home',
    exercises: [
      ex('planche_lean', 'Tuck planche lean on parallettes', 'shoulders', '3 × 20 s', { track: 'planche_lean' }),
      ex('pike_pushup', 'Pike push-ups on parallettes (wall walks from week 4)', 'shoulders', '3 × 8'),
      ex('t2b', 'Toes-to-bar on the home bar', 'core', '3 × 10'),
      ex('body_saw', 'Slider body saw', 'core', '3 × 10'),
      ex('lsit_circuit', 'Parallette L-sit', 'core', '3 × max', { track: 'lsit_tuck', levelTracks: { full: 'lsit' } }),
      ex('side_plank', 'Side plank', 'core', '2 × 30 s/side')
    ]
  },
  H2: {
    name: 'H2 — Legs, ski + kicks', kind: 'home', legs: true,
    exercises: [
      ex('rope_footwork', 'Jump rope footwork', 'cardio', '3 × 1 min'),
      ex('slider_lat_lunge', 'Slider lateral lunge', 'legs', '3 × 8/side'),
      ex('step_down', 'Slow step-down from a stair or box', 'legs', '3 × 8/leg'),
      ex('skater_hop', 'Skater hops (knee ≤ 3/10 only)', 'legs', '3 × 8/side', { taperDrop: true }),
      ex('shadow_kicks', 'Shadow kicks, both legs, full speed', 'legs', '4 × 1 min'),
      ex('copenhagen', 'Copenhagen plank on a sofa or bench', 'core', '3 × 20 s/side'),
      ex('wall_sit_fail', 'Wall sit to failure', 'legs', '1', { track: 'wall_sit' })
    ]
  },
  H3: {
    name: 'H3 — Grip, shoulders + conditioning', kind: 'home',
    exercises: [
      ex('rope_intervals', 'Jump rope intervals', 'cardio', '8 × (30 s fast, 30 s easy)', { track: 'double_unders' }),
      ex('home_pullup_belt', 'Belt-loaded pull-ups on the home bar', 'back', '3 × 5, moderate'),
      ex('deficit_pushup', 'Parallette deficit push-ups', 'chest', '2 × max'),
      ex('club_flow', 'Steel club casts, mills, swipes flow', 'shoulders', '3 rounds × 10/side'),
      ex('club_hold', 'Single-arm club hold at arm\'s length', 'forearms', '3 × 20 s/hand'),
      ex('towel_hang', 'Towel dead hang', 'forearms', '2 × max'),
      ex('face_pull_pallof', 'Band face pull + Pallof press', 'shoulders', '2 × 15 + 2 × 10/side')
    ]
  }
};

export const GYM_ORDER = ['A', 'B', 'C', 'D'];
export const HOME_ORDER = ['H1', 'H2', 'H3'];
export const HIGH_DAY_SESSIONS = ['B', 'D']; // calorie-cycling high days: legs and the 4×4 get fuel

// Sample week (0 = Sunday … 6 = Saturday): which days are gym / home / ruck days. The ORDER decides which session.
export const WEEK = {
  0: { gym: false, home: 'optional', walk: 'easy walk' },
  1: { gym: true, home: false, walk: 'walk' },
  2: { gym: true, home: true, walk: 'ruck' },
  3: { gym: false, home: true, walk: 'walk' },
  4: { gym: true, home: false, walk: 'walk' },
  5: { gym: true, home: false, walk: 'ruck' },
  6: { gym: 'optional', home: true, walk: 'walk' }
};
export const RUCK = { startKg: 9, addKgEvery2Weeks: 2, maxKg: 18, from: '2026-11-23', minutes: '45–60' };

export const BLOCKS = [
  { name: 'Build 1', from: '2026-11-23', to: '2026-12-13', type: 'build' },
  { name: 'Test week', from: '2026-12-14', to: '2026-12-20', type: 'test', note: 'Normal sessions; run the tests across this week' },
  { name: 'Taper + ski', from: '2026-12-21', to: '2027-01-03', type: 'taper', note: 'Halve the sets in B and H2, drop skater hops; travel-day routine (morning + H3 + walk) when not skiing' },
  { name: 'Build 2', from: '2027-01-04', to: '2027-01-24', type: 'build' },
  { name: 'Easy + test', from: '2027-01-25', to: '2027-01-31', type: 'deload', note: 'Half sets at the same weights; run the tests' },
  { name: 'Build 3', from: '2027-02-01', to: '2027-02-21', type: 'build' },
  { name: 'Easy + final test', from: '2027-02-22', to: '2027-03-07', type: 'deload', note: 'Half sets; tests, photos, tape' }
];

export const TESTS = 'Max strict pull-ups · best freestanding handstand · L-sit and front lever holds · belt 5-rep best on pull-ups and dips · hammer-curl weight · max push-ups in 2 min · 5 km ruck at 15 kg (timed) · 500 m row or 400 m swim (timed) · waist, weight and photos';

export const MILESTONES = [
  { date: '2026-12-04', name: 'Week 2', weight: '~77 kg', waist: '~28.8"', training: 'Morning streak 14 days; rucks at 10 kg; front lever tuck 12 s; 5 clean chest-to-bar', offTrack: 'Waist moved < 0.3": cut feasts to one a fortnight' },
  { date: '2026-12-18', name: 'Week 4 (test week)', weight: '75.5–76 kg', waist: '~28.3"', training: 'Pull-ups +12.5 kg × 5, dips +22.5 kg × 6; band-assisted muscle-ups; tuck L-sit 20 s; benchmarks; photos', offTrack: 'Arms < 14.8" or lifts dropping: add a high day' },
  { date: '2027-01-04', name: 'Week 6 (back from skiing)', weight: '75.5–76 kg', waist: '~28.2"', training: 'Strength held; first strict muscle-up attempt', offTrack: 'Waist > 28.5": run the January cut' },
  { date: '2027-01-31', name: 'Target', weight: '73.5–74 kg', waist: '≤ 27.5"', training: 'Side-delt and triceps separation, serratus starting to show', offTrack: null }
];

// Skill ladders. `higher` is always better. unit: s = seconds, kg = added load, reps.
export const LADDERS = [
  { key: 'muscle_up', name: 'Strict muscle-up', unit: 'reps', start: 0, target: 1, next: '5 clean chest-to-bar → band-assisted (aim: Feb)' },
  { key: 'ctb', name: 'Explosive chest-to-bar', unit: 'reps', start: 3, target: 5 },
  { key: 'max_pullups', name: 'Max strict pull-ups', unit: 'reps', start: 10, target: 14 },
  { key: 'pullup_weighted', name: 'Weighted pull-up ×5', unit: 'kg', start: 10, target: 15, next: '+12.5 kg by test week' },
  { key: 'dip_weighted', name: 'Weighted dip ×6', unit: 'kg', start: 20, target: 27.5, next: '+25 kg × 6' },
  { key: 'fl_tuck', name: 'Front lever, tuck', unit: 's', start: 0, target: 15, next: 'Then advanced tuck' },
  { key: 'front_lever', name: 'Front lever, advanced tuck', unit: 's', start: 0, target: 10 },
  { key: 'hs_wall', name: 'Chest-to-wall handstand', unit: 's', start: 30, target: 45 },
  { key: 'hs_free', name: 'Freestanding handstand', unit: 's', start: 0, target: 15, next: '5 s first, then 15–30 s' },
  { key: 'lsit_tuck', name: 'L-sit, tuck or one leg', unit: 's', start: 0, target: 20, next: 'Then one leg out → full' },
  { key: 'lsit', name: 'L-sit, full', unit: 's', start: 0, target: 15 },
  { key: 'planche_lean', name: 'Planche lean', unit: 's', start: 0, target: 30, next: '20 s tuck lean first' },
  { key: 'double_unders', name: 'Double-unders unbroken', unit: 'reps', start: 0, target: 50, next: '20 s continuous first' },
  { key: 'dead_hang', name: 'Dead hang', unit: 's', start: 0, target: 90, next: 'Past 90 s: alternate days with a towel grip' },
  { key: 'hammer_curl', name: 'Hammer curl top set', unit: 'kg', start: 0, target: null },
  { key: 'wall_sit', name: 'Wall sit', unit: 's', start: 0, target: 120 }
];

export const ALL_EXERCISES = (() => {
  const m = new Map();
  const add = e => { if (!m.has(e.id)) m.set(e.id, e); };
  MORNING.forEach(add);
  Object.values(SESSIONS).forEach(s => s.exercises.forEach(e => { add(e); (e.circuit || []).forEach(add); }));
  return m;
})();

const weekday = date => new Date(`${date}T12:00:00Z`).getUTCDay();
export const blockFor = (date = today()) => BLOCKS.find(b => date >= b.from && date <= b.to) || null;

// Next session in an order: the one after the last logged session of that order before `date`;
// if one was already logged on `date`, that one is today's.
function nextInOrder(events, order, date) {
  const logged = (events || []).filter(e => e.type === 'workout' && order.includes(e.session) && e.date <= date).sort((a, b) => a.ts - b.ts);
  const onDay = logged.filter(e => e.date === date).pop();
  if (onDay) return onDay.session;
  const last = logged.pop();
  return last ? order[(order.indexOf(last.session) + 1) % order.length] : order[0];
}

function build(key, date) {
  const s = SESSIONS[key], b = blockFor(date);
  const taper = b?.type === 'taper', deload = b?.type === 'deload';
  const halve = t => t.replace(/^(\d+)(\s*[×x])/, (m, n, x) => `${Math.max(1, Math.ceil(n / 2))}${x}`);
  const exercises = s.exercises
    .filter(e => !(taper && e.taperDrop))
    .map(e => ((taper && s.legs) || deload) ? { ...e, target: halve(e.target) } : e);
  return { key, name: s.name, kind: s.kind, warmup: s.warmup ? WARMUPS[s.warmup] : null, exercises, block: b };
}

const shiftDay = (date, n) => new Date(new Date(`${date}T12:00:00Z`).getTime() + n * 864e5).toISOString().slice(0, 10);

// Session key for a date: by order up to today; for later dates, projected forward assuming each
// scheduled gym/home day of the sample week does the next one (optional days don't advance it).
const choiceFor = (events, order, date) => (events || []).filter(e => e.type === 'session_choice' && e.date === date && order.includes(e.key)).sort((a, b) => a.ts - b.ts).pop()?.key || null;

// His own pick of gym days for a Sun–Sat week (`week_commit`, set from the Saturday recap) overrides the sample week.
export const commitFor = (events, date) => { const ws = shiftDay(date, -weekday(date)); return (events || []).filter(e => e.type === 'week_commit' && e.week_start === ws).sort((a, b) => a.ts - b.ts).pop() || null; };
export const isGymDay = (events, date) => { const c = commitFor(events, date); return c ? c.days.includes(date) : WEEK[weekday(date)].gym === true; };
const trainingDay = (events, field, d) => field === 'gym' ? isGymDay(events, d) : WEEK[weekday(d)][field] === true;

function keyFor(events, order, field, date) {
  const t = today();
  if (date <= t) return choiceFor(events, order, date) || nextInOrder(events, order, date);
  let key = choiceFor(events, order, t) || nextInOrder(events, order, t);
  const doneToday = (events || []).some(e => e.type === 'workout' && e.session === key && e.date === t);
  if (trainingDay(events, field, t) || doneToday || choiceFor(events, order, t)) key = order[(order.indexOf(key) + 1) % order.length];
  for (let d = shiftDay(t, 1); d < date; d = shiftDay(d, 1)) if (trainingDay(events, field, d)) key = order[(order.indexOf(key) + 1) % order.length];
  return key;
}

// The day's gym session (by order) and whether it's a gym day in the sample week (true / 'optional' / false).
export function sessionFor(date = today(), events = []) {
  const chosen = choiceFor(events, GYM_ORDER, date);
  return { ...build(keyFor(events, GYM_ORDER, 'gym', date), date), dayType: chosen ? true : commitFor(events, date) ? isGymDay(events, date) : WEEK[weekday(date)].gym, chosen: !!chosen };
}
export function homeFor(date = today(), events = []) {
  let key = keyFor(events, HOME_ORDER, 'home', date), swapped = null;
  // Rule: a day between B and H2 (both hit the legs). If B is today or was yesterday, H2 waits.
  if (key === 'H2') {
    const bNear = [date, shiftDay(date, -1)].some(d => (events || []).some(e => e.type === 'workout' && e.session === 'B' && e.date === d) || keyFor(events, GYM_ORDER, 'gym', d) === 'B' && isGymDay(events, d));
    if (bNear) { swapped = 'H2'; key = 'H3'; }
  }
  const chosen = choiceFor(events, HOME_ORDER, date);
  if (chosen) { key = chosen; swapped = null; }
  return { ...build(key, date), dayType: chosen ? true : WEEK[weekday(date)].home, swapped, chosen: !!chosen };
}
export const walkFor = (date = today()) => WEEK[weekday(date)].walk;
export function ruckKg(date = today()) {
  const weeks = Math.max(0, Math.floor((new Date(`${date}T12:00:00Z`) - new Date(`${RUCK.from}T12:00:00Z`)) / 6048e5));
  return Math.min(RUCK.maxKg, RUCK.startKg + Math.floor(weeks / 2) * RUCK.addKgEvery2Weeks);
}

// Compact list the parser uses to map free text to plan ids.
export const PARSER_CATALOG = [...ALL_EXERCISES.values()].map(e => `${e.id}: ${e.name}`).join('\n');

// Where each muscle group is trained across the week (used when he asks to add work, so additions fit the programme).
export function programmeCoverage() {
  const by = {};
  const add = (m, where) => { (by[m] ||= new Set()).add(where); };
  MORNING.forEach(e => add(e.muscle, 'morning'));
  for (const [k, s] of Object.entries(SESSIONS)) s.exercises.forEach(e => { add(e.muscle, k); (e.circuit || []).forEach(c => add(c.muscle, k)); });
  add('traps', 'none directly (some from farmer carries in D, heavy deadlifts in B, rucks)');
  return Object.entries(by).filter(([m]) => m !== 'mobility' && m !== 'cardio').map(([m, w]) => `${m}: ${[...w].join(', ')}`).join('; ');
}
