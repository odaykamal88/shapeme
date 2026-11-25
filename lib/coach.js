// One-line verdict on the day so far: on track / need more info / be careful / enjoy.
// Pure rules, no API call. "Budget" = today's phase calories and the protein target.
import { CONFIG, today } from './config.js';
import { todayTarget } from './diet.js';
import { dayFood } from './summary.js';

const fmt = n => Math.round(n).toLocaleString('en-US');
const cairoHour = () => Number(new Date().toLocaleString('en-GB', { timeZone: CONFIG.tz, hour: '2-digit', hour12: false })) % 24;

const shiftDay = (date, n) => new Date(new Date(`${date}T12:00:00Z`).getTime() + n * 864e5).toISOString().slice(0, 10);

// From 21:00 the day is effectively over: wrap it up and point at tomorrow instead of "the rest of today".
function nightLines(events, d, tt, pTarget) {
  const t = today(), tomorrow = shiftDay(t, 1);
  const newWeek = new Date(`${tomorrow}T12:00:00Z`).getUTCDay() === 0;
  const t2 = todayTarget(events, tomorrow);
  const left = tt.kcal - d.kcal, pShort = Math.max(0, pTarget - d.protein);
  const biggest = events.filter(e => e.type === 'food' && e.date === t && !e.cheat).flatMap(e => e.items || []).sort((a, b) => (b.kcal || 0) - (a.kcal || 0))[0];
  const kind = t2.cycling ? (t2.type === 'low' ? ' (low day)' : t2.type === 'feast' ? ' (feast day)' : ' (high day)') : '';
  const tmr = newWeek ? `Tomorrow starts a fresh week at <b>${fmt(t2.kcal)} kcal</b>${kind}.` : `Tomorrow's target: <b>${fmt(t2.kcal)} kcal</b>${kind}${!t2.cycling && t2.carried > 100 ? ` (this week's extra ${fmt(t2.carried)} kcal is spread over the days left)` : ''}.`;
  const lines = [];
  if (left < -150) {
    lines.push(`🌙 <b>Closed ${fmt(-left)} kcal over.</b> Nothing to fix tonight. ${tmr}`);
    lines.push(`➡️ <b>Tomorrow</b>: protein-heavy breakfast, steps in before lunch${biggest && biggest.kcal >= 250 ? `, and watch the biggest swing from today: ${biggest.name.toLowerCase()} (~${fmt(biggest.kcal)})` : ''}.`);
  } else if (left > 400) {
    lines.push(`🌙 <b>Closed ${fmt(left)} kcal under.</b> Don't force food before bed${pShort > 25 ? ', but a whey shake or Greek yogurt is worth it if you\'re hungry' : ''}. ${tmr}`);
  } else {
    lines.push(`✅ <b>Day closed on target</b>: ${fmt(d.kcal)} kcal, ${d.protein} g protein. ${tmr}`);
  }
  if (pShort > 25) lines.push(`💪 Protein finished ${pShort} g short: build tomorrow around it (eggs + yogurt at breakfast, whey after training).`);
  return lines;
}

export function verdict(events, food = null, { night = null } = {}) {
  const d = dayFood(events, today());
  const tt = todayTarget(events), target = tt.kcal, pTarget = tt.protein || CONFIG.proteinG;
  const h = cairoHour();
  const isNight = night ?? (h >= 21 || h < 4);
  const dayShare = Math.min(1, Math.max(0.15, (h - 7) / 14)); // share of the day's food expected by now (07:00 → 21:00)
  const left = target - d.kcal, pLeft = Math.max(0, pTarget - d.protein);
  const lines = [];

  if (food?.cheat) {
    if (tt.extraFeasts) lines.push(`🍖 <b>Second feast this week</b>: it takes another high day, so the rest of the week runs low.`);
    else if (tt.cycling) lines.push(`🍖 <b>Feast day</b>: today's cap is ${fmt(tt.feastCap)} kcal and it uses one of this week's high days. Meat first, then bread or dessert, not both. Enjoy it.`);
    else lines.push(`🍖 <b>Feast</b> logged: it counts toward this week's budget. Enjoy it.`);
  }
  if (food?.missing_info) lines.push(`🤔 <b>Need more info:</b> ${food.missing_info} Reply to this message and I'll correct it.`);

  if (isNight) return [...lines, ...nightLines(events, d, tt, pTarget)].join('\n');

  if (left < 0) lines.push(`🛑 <b>Over budget</b> by ${fmt(-left)} kcal. Keep the rest of today to lean protein and veg; an extra walk helps.`);
  else if (left < 300) lines.push(`⚠️ <b>Be careful:</b> only ${fmt(left)} kcal left${pLeft > 20 ? ` with ${pLeft} g protein to go: whey, Greek yogurt, egg whites or chicken` : ''}.`);
  else if (d.kcal > target * dayShare + 400) lines.push(`⚠️ <b>Ahead of pace:</b> ${fmt(left)} kcal left for the rest of the day, so go lighter at the next meal.`);
  else if (h >= 18 && left >= 700) lines.push(`😋 <b>Enjoy:</b> you've got ${fmt(left)} kcal left${pLeft > 30 ? `; get ${pLeft} g protein in there` : ''}.`);
  else if (d.protein < pTarget * dayShare - 30) lines.push(`💪 <b>Calories on track, protein behind:</b> ${pLeft} g to go with ${fmt(left)} kcal left.`);
  else lines.push(`✅ <b>On track:</b> ${fmt(left)} kcal and ${pLeft} g protein left.`);

  return lines.join('\n');
}
