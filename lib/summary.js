import { CONFIG, today, currentPhase } from './config.js';
import { SEED_MEASUREMENTS } from './seed.js';
import { setsPerMuscle } from './training.js';

export const allMeas = logged =>
  [...SEED_MEASUREMENTS, ...logged].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.ts || 0) - (b.ts || 0)));

const daysAgo = n => today(new Date(Date.now() - n * 864e5));

export function dayFood(events, date) {
  const f = events.filter(e => e.type === 'food' && e.date === date);
  const sum = k => f.reduce((s, e) => s + (e.total?.[k] || 0), 0);
  return { meals: f.length, kcal: sum('kcal'), protein: sum('protein_g'), carbs: sum('carbs_g'), fat: sum('fat_g') };
}

export function weekStats(events, measurements, days = 7) {
  const from = daysAgo(days - 1);
  const ev = events.filter(e => e.date >= from);
  const food = ev.filter(e => e.type === 'food');
  const loggedDays = [...new Set(food.map(e => e.date))];
  const kcal = food.reduce((s, e) => s + (e.total?.kcal || 0), 0);
  const protein = food.reduce((s, e) => s + (e.total?.protein_g || 0), 0);
  const bySetting = {}, byMeal = {};
  food.forEach(e => {
    bySetting[e.setting || 'unknown'] = (bySetting[e.setting || 'unknown'] || 0) + (e.total?.kcal || 0);
    byMeal[e.meal || 'unknown'] = (byMeal[e.meal || 'unknown'] || 0) + (e.total?.kcal || 0);
  });
  const items = food.flatMap(e => (e.items || []).map(i => ({ ...i, date: e.date, setting: e.setting })))
    .sort((a, b) => b.kcal - a.kcal).slice(0, 8);
  const hidden = food.flatMap(e => e.hidden_calories || []);
  const stepsByDate = {};
  ev.filter(e => e.type === 'steps').forEach(e => { stepsByDate[e.date] = e.steps; });
  const stepVals = Object.values(stepsByDate);
  const sets = setsPerMuscle(events, days);
  const m = allMeas(measurements);
  const latest = [...m].reverse().find(x => x.waist);
  const weights = m.filter(x => x.weight && x.date >= from).map(x => x.weight);
  return {
    from, to: today(), phase: currentPhase(),
    loggedDays: loggedDays.length,
    avgKcal: loggedDays.length ? Math.round(kcal / loggedDays.length) : null,
    avgProtein: loggedDays.length ? Math.round(protein / loggedDays.length) : null,
    kcalBySetting: bySetting, kcalByMeal: byMeal, topItems: items, hiddenCalories: hidden.slice(0, 12),
    avgSteps: stepVals.length ? Math.round(stepVals.reduce((a, b) => a + b, 0) / stepVals.length) : null,
    setsPerMuscle: sets,
    weightsThisWeek: weights,
    latestMeasurement: latest,
    ratio: latest?.shoulders && latest?.waist ? +(latest.shoulders / latest.waist).toFixed(2) : null,
    targets: CONFIG.targets, floors: CONFIG.floors, proteinTarget: CONFIG.proteinG, stepsTarget: CONFIG.stepsTarget
  };
}
