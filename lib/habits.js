// Eating patterns: staples (eaten on most logged days) vs occasional foods, and coaching tips for each.
// Detection is rules (no API cost); tips come from one Claude call on Sundays or /habits, and are then
// shown in context when you log a matching meal (each at most once a day).
import { today } from './config.js';
import { ask } from './claude.js';
import { HABITS } from './schemas.js';
import { addEvent } from './store.js';
import { getProfile, personaPrompt } from './persona.js';

const STOP = new Set(['low', 'fat', 'free', 'cooked', 'raw', 'fresh', 'sliced', 'drained', 'brine', 'with', 'and', 'the', 'large', 'small', 'medium', 'half', 'plain', 'grilled', 'homemade', 'shared', 'piece', 'pieces', 'scoop', 'scoops', 'cup', 'glass', 'slice', 'slices', 'about']);
export const tokens = name => [...new Set(String(name).toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[^a-z؀-ۿ ]/g, ' ').split(/\s+/).filter(w => w.length >= 3 && !STOP.has(w)))];
export const similar = (a, b) => { const A = new Set(a), B = new Set(b); const inter = [...A].filter(x => B.has(x)).length; return inter / Math.max(1, Math.min(A.size, B.size)) >= 0.6 && inter >= 1; };

export function foodHabits(events, days = 14) {
  const from = today(new Date(Date.now() - (days - 1) * 864e5));
  const food = events.filter(e => e.type === 'food' && e.date >= from);
  const loggedDays = [...new Set(food.map(e => e.date))];
  const clusters = [];
  for (const e of food) for (const it of e.items || []) {
    const t = tokens(it.name); if (!t.length) continue;
    let c = clusters.find(c => similar(c.tokens, t));
    if (!c) clusters.push(c = { name: it.name, tokens: t, days: new Set(), n: 0, kcal: 0, protein: 0, settings: new Set(), cheat: 0 });
    c.days.add(e.date); c.n++; c.kcal += it.kcal || 0; c.protein += it.protein_g || 0; c.settings.add(e.setting || 'home'); if (e.cheat) c.cheat++;
  }
  const total = food.reduce((s, e) => s + (e.total?.kcal || 0), 0) || 1;
  const rows = clusters.map(c => ({ name: c.name, tokens: c.tokens, daysSeen: c.days.size, avgKcal: Math.round(c.kcal / c.n), avgProtein: Math.round(c.protein / c.n),
    shareOfKcal: Math.round((c.kcal / total) * 100), settings: [...c.settings], cheat: c.cheat > 0 }));
  const n = loggedDays.length;
  const staple = r => n >= 3 ? r.daysSeen >= Math.max(3, Math.ceil(n * 0.4)) : false;
  return {
    loggedDays: n,
    staples: rows.filter(staple).sort((a, b) => b.daysSeen - a.daysSeen || b.shareOfKcal - a.shareOfKcal).slice(0, 12),
    occasional: rows.filter(r => !staple(r) && (r.cheat || r.settings.some(s => s !== 'home') || r.avgKcal >= 300)).sort((a, b) => b.shareOfKcal - a.shareOfKcal).slice(0, 8),
    note: n < 3 ? 'Fewer than 3 logged days: staples not detected yet; treat foods he describes as routine (profile notes) as staples.' : null
  };
}

export const latestTips = events => events.filter(e => e.type === 'habit_tips').sort((a, b) => b.ts - a.ts)[0] || null;

// Tip to show with a newly logged meal: a staple tip for one of its items, or an occasional tip for an eating-out / cheat meal.
// `todayEvents` are today's events before this meal was saved, so each tip shows at most once a day.
export function habitTip(events, food) {
  const tips = latestTips(events); if (!tips) return null;
  const shown = new Set(events.filter(e => e.type === 'food' && e.date === today() && e.tip_shown).map(e => e.tip_shown));
  for (const it of food.items || []) {
    const s = (tips.staples || []).find(s => similar(tokens(s.item), tokens(it.name)));
    if (s && !shown.has(s.item)) return { key: s.item, text: `💡 <b>Daily ${s.item.toLowerCase()}</b>: ${s.tip}` };
  }
  const out = food.cheat || ['restaurant', 'social'].includes(food.setting);
  const o = out && (tips.occasional || []).find(o => !shown.has(o.when));
  return o ? { key: o.when, text: `💡 <b>${o.when}</b>: ${o.tip}` } : null;
}

export async function refreshTips(events) {
  const h = foodHabits(events, 14);
  const profile = await getProfile();
  const out = await ask({
    system: `${personaPrompt(profile, events)}
You're reviewing his eating patterns. STAPLES are foods he eats on most days: small upgrades there compound, so give practical tweaks (portion, cooking fat, a swap, a protein boost, timing) that keep the meal he likes. OCCASIONAL meals (eating out, social, cheat meal) need situational strategy for next time, not restriction.
Return up to 4 staple tips and up to 3 occasional tips. "item" must be a short food name taken from the staples given (or from his profile's routine foods if staples aren't detected yet). "when" is a short label like "Eating out", "Social dinner", "Cheat meal". Each tip ≤ 25 words, plain text, with a rough number (kcal saved or protein added) where possible. summary: one sentence on the overall pattern.`,
    content: JSON.stringify({ staples: h.staples.map(({ tokens, ...r }) => r), occasional: h.occasional.map(({ tokens, ...r }) => r), loggedDays: h.loggedDays, note: h.note }),
    maxTokens: 4000, schema: HABITS, effort: 'medium'
  });
  await addEvent('habit_tips', out);
  return { ...out, habits: h };
}

export function habitsMessage(r) {
  const h = r.habits;
  const staples = h.staples.length ? h.staples.map(s => `• ${s.name}: ${s.daysSeen}/${h.loggedDays} days, ~${s.avgKcal} kcal, ${s.avgProtein} g protein`).join('\n') : '<i>Not enough days logged yet to spot staples automatically (needs 3+).</i>';
  return `🔁 <b>Your eating patterns</b> (last ${h.loggedDays} logged day${h.loggedDays === 1 ? '' : 's'})\n\n${r.summary}\n\n<b>Staples</b>\n${staples}\n\n<b>Upgrades for the daily stuff</b>\n${(r.staples || []).map(s => `• <b>${s.item}</b>: ${s.tip}`).join('\n') || '–'}\n\n<b>For the occasional meals</b>\n${(r.occasional || []).map(o => `• <b>${o.when}</b>: ${o.tip}`).join('\n') || '–'}\n\n<i>These tips pop up when you log a matching meal, once a day each. Refreshed every Sunday, or send /habits.</i>`;
}
