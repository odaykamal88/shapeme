// The one-page weekly report (PDF): fixed goals, where he is, the week in numbers, skills, and how the plan
// has been tailored from his data. Sent with the Sunday evening recap after a solid week, or on request.
import PDFDocument from 'pdfkit';
import { CONFIG, today, currentPhase } from './config.js';
import { MILESTONES, LADDERS } from './plan.js';
import { dayFood, weekStats } from './summary.js';
import { todayTarget } from './diet.js';
import { adherence, ladderProgress } from './training.js';
import { recoverySummary } from './recovery.js';
import { habitState } from './habit.js';
import { listPhotos, readPhoto } from './store.js';

const shift = (d, n) => new Date(new Date(`${d}T12:00:00Z`).getTime() + n * 864e5).toISOString().slice(0, 10);
const fmtD = d => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const n = x => x == null ? '–' : Math.round(x).toLocaleString('en-US');
// Built-in PDF fonts cover Latin-1 only: map the few symbols we use, drop the rest (emoji etc.).
const safe = s => String(s ?? '').replace(/≤/g, '<=').replace(/≥/g, '>=').replace(/[→➡]/g, '->').replace(/[″“”]/g, '"').replace(/[‘’]/g, "'").replace(/[–—]/g, '-').replace(/<[^>]+>/g, '').replace(/[^\x00-\xFF]/g, '').trim();

// A week that earns the report: showing up, not perfection.
export function solidWeek(ev) {
  const days = Array.from({ length: 7 }, (_, i) => shift(today(), -i));
  const checkins = days.filter(d => ev.some(e => e.date === d && (e.type === 'recovery' || e.type === 'routine'))).length;
  const foodDays = days.filter(d => ev.some(e => e.date === d && e.type === 'food')).length;
  const sessions = days.filter(d => ev.some(e => e.date === d && e.type === 'workout' && e.session !== 'morning')).length;
  return { solid: checkins >= 5 && foodDays >= 5 && sessions >= 4, checkins, foodDays, sessions };
}

export function goalsAndChanges(ev, meas) {
  const t = today(), next = MILESTONES.find(m => m.date >= t);
  const goals = [
    `Weight ${CONFIG.targets.weight} kg, waist <= ${CONFIG.targets.waist}", shoulder-to-waist ratio ${CONFIG.targets.ratio}`,
    `Keep arms >= ${CONFIG.floors.arms}" and shoulders >= ${CONFIG.floors.shoulders}" while cutting`,
    next ? `Next checkpoint ${fmtD(next.date)} (${next.name}): ${next.weight}, waist ${next.waist}; ${next.training}` : null,
    `Skills by March: ${LADDERS.filter(l => l.target != null && ['muscle_up', 'front_lever', 'hs_free', 'lsit', 'pullup_weighted', 'dip_weighted'].includes(l.key)).map(l => `${l.name} ${l.target}${l.unit === 'kg' ? ' kg' : l.unit === 's' ? ' s' : ''}`).join(', ')}`
  ].filter(Boolean);
  const changes = [];
  for (const e of ev.filter(e => e.type === 'coach_log')) for (const r of e.rationale || []) changes.push({ date: e.date, area: r.area, text: `${r.change}: ${r.why}` });
  for (const e of ev.filter(e => e.type === 'diet_tweak')) changes.push({ date: e.date, area: 'diet', text: `Calorie cycling tuned${e.low ? `, low ${e.low}` : ''}${e.high ? `, high ${e.high}` : ''}${e.protein ? `, protein ${e.protein} g` : ''}: ${e.why}` });
  for (const e of ev.filter(e => e.type === 'routine_plan')) changes.push({ date: e.date, area: 'stretches', text: `Morning routine updated: ${e.why}` });
  const home = ev.filter(e => e.type === 'week_plan' && e.where).map(e => e.date);
  if (home.length) changes.push({ date: home.at(-1), area: 'workout', text: `${new Set(home).size} session(s) rebuilt for training at home with your kit` });
  const picks = ev.filter(e => e.type === 'session_choice');
  if (picks.length) changes.push({ date: picks.at(-1).date, area: 'workout', text: `Session order followed your picks on ${new Set(picks.map(p => p.date)).size} day(s)` });
  if (ev.some(e => e.type === 'workout' && e.place)) changes.push({ date: t, area: 'diet', text: 'Home versions of B/D count as low days (lighter loads)' });
  return { goals, changes: changes.sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 10) };
}

export async function buildReport(ev, meas) {
  const t = today(), from = shift(t, -6), ph = currentPhase(t);
  const w = weekStats(ev, meas, 7), a = adherence(ev, 7), rec = recoverySummary(ev), hs = habitState(ev), sw = solidWeek(ev);
  const { goals, changes } = goalsAndChanges(ev, meas);
  const weights = meas.filter(m => m.weight && m.date >= shift(t, -29)).sort((x, y) => (x.date < y.date ? -1 : 1));
  const avg7 = d => { const xs = weights.filter(m => m.date <= d && m.date > shift(d, -7)).map(m => m.weight); return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null; };
  const lastTape = [...meas].reverse().find(m => m.waist), lastW = avg7(t) ?? weights.at(-1)?.weight ?? null;
  const days = Array.from({ length: 7 }, (_, i) => shift(from, i)).map(d => ({ d, kcal: dayFood(ev, d).kcal, target: todayTarget(ev, d).kcal, logged: dayFood(ev, d).meals > 0 }));

  const doc = new PDFDocument({ size: 'A4', margin: 40, info: { Title: `Weekly report ${t}` } });
  const chunks = []; doc.on('data', c => chunks.push(c));
  const done = new Promise(r => doc.on('end', r));
  const W = doc.page.width - 80, ink = '#151821', mute = '#6b7280', accent = '#2563eb', good = '#16a34a', bad = '#dc2626', line = '#e5e7eb';
  const h2 = s => { doc.moveDown(0.6).fillColor(accent).font('Helvetica-Bold').fontSize(11).text(safe(s).toUpperCase(), { characterSpacing: 0.5 }).moveDown(0.25).fillColor(ink).font('Helvetica').fontSize(10); };
  const bullet = s => doc.text(`•  ${safe(s)}`, { width: W, paragraphGap: 2 });

  doc.fillColor(ink).font('Helvetica-Bold').fontSize(20).text('Your week');
  doc.font('Helvetica').fontSize(10).fillColor(mute).text(safe(`${fmtD(from)} - ${fmtD(t)} · ${ph.name}${hs.onboarding ? ` · habit day ${hs.day} of 20` : ''} · ${sw.solid ? 'solid week' : 'building'}`));

  h2('Where you are headed (fixed)');
  goals.forEach(bullet);

  h2('Where you are');
  const tile = (x, label, value, sub, ok) => { doc.fillColor(mute).fontSize(8).text(label.toUpperCase(), x, doc.y0, { width: W / 4 - 8 }); doc.fillColor(ok == null ? ink : ok ? good : bad).font('Helvetica-Bold').fontSize(16).text(safe(value), x, doc.y0 + 11, { width: W / 4 - 8 }); doc.fillColor(mute).font('Helvetica').fontSize(8).text(safe(sub), x, doc.y0 + 31, { width: W / 4 - 8 }); };
  doc.y0 = doc.y;
  const ratio = lastTape?.shoulders && lastTape?.waist ? lastTape.shoulders / lastTape.waist : null;
  tile(40, 'Weight (7-day avg)', lastW ? `${lastW.toFixed(1)} kg` : '–', `target ${CONFIG.targets.weight} kg`, lastW ? lastW <= CONFIG.targets.weight + 0.5 : null);
  tile(40 + W / 4, 'Waist', lastTape ? `${lastTape.waist}"` : '–', `target <= ${CONFIG.targets.waist}" · ${lastTape ? fmtD(lastTape.date) : ''}`, lastTape ? lastTape.waist <= CONFIG.targets.waist : null);
  tile(40 + W / 2, 'Shoulder / waist', ratio ? ratio.toFixed(2) : '–', `target ${CONFIG.targets.ratio}`, ratio ? ratio >= CONFIG.targets.ratio : null);
  tile(40 + 3 * W / 4, 'Arms', lastTape?.arms ? `${lastTape.arms}"` : '–', `floor ${CONFIG.floors.arms}"`, lastTape?.arms ? lastTape.arms >= CONFIG.floors.arms : null);
  doc.x = 40; doc.y = doc.y0 + 48;

  // Weight, last 30 days: daily dots + 7-day average line.
  if (weights.length >= 2) {
    const x0 = 40, y0 = doc.y + 6, cw = W, chh = 90, ws = weights.map(m => m.weight), lo = Math.min(...ws) - 0.5, hi = Math.max(...ws) + 0.5;
    const X = d => x0 + ((new Date(d) - new Date(shift(t, -29))) / (29 * 864e5)) * cw, Y = v => y0 + chh - ((v - lo) / (hi - lo)) * chh;
    doc.lineWidth(0.5).strokeColor(line).rect(x0, y0, cw, chh).stroke();
    weights.forEach(m => doc.circle(X(m.date), Y(m.weight), 1.6).fillColor('#93c5fd').fill());
    const pts = weights.map(m => [X(m.date), Y(avg7(m.date))]);
    doc.lineWidth(1.5).strokeColor(accent).moveTo(...pts[0]); pts.slice(1).forEach(p => doc.lineTo(...p)); doc.stroke();
    doc.fillColor(mute).fontSize(7).text(`${hi.toFixed(1)} kg`, x0 + 2, y0 + 2).text(`${lo.toFixed(1)} kg`, x0 + 2, y0 + chh - 9).text('Weight, last 30 days (dots daily, line 7-day average)', x0, y0 + chh + 3);
    doc.x = 40; doc.y = y0 + chh + 14;
  }

  h2('This week');
  const steps = w.avgSteps;
  bullet(`Food: ${n(w.avgKcal)} kcal a day on ${w.loggedDays} logged days · protein ${n(w.avgProtein)} g (target ${ph.protein || CONFIG.proteinG} g)`);
  bullet(`Training: ${a.sessions7} gym (aim 4-5) · ${a.home7} home (aim 3-5) · ${sw.checkins}/7 morning check-ins · streak ${hs.checkinStreak}`);
  bullet(`Steps: ${n(steps)} a day (target ${n(CONFIG.stepsTarget)}) · sleep ${rec.sleepAvg7 ?? '–'} h · morning wood ${rec.woodRate7 != null ? Math.round(rec.woodRate7 * 100) + '%' : '–'}`);
  // Calories vs target, per day.
  { const x0 = 40, y0 = doc.y + 8, chh = 70, bw = W / 7 - 10, max = Math.max(...days.map(d => Math.max(d.kcal, d.target)), 1);
    days.forEach((d, i) => { const x = x0 + i * (W / 7) + 5, hh = (d.kcal / max) * chh, th = (d.target / max) * chh;
      doc.rect(x, y0 + chh - hh, bw, hh).fillColor(d.logged ? (d.kcal <= d.target + 100 ? '#86efac' : '#fca5a5') : line).fill();
      doc.lineWidth(1).strokeColor(ink).moveTo(x - 2, y0 + chh - th).lineTo(x + bw + 2, y0 + chh - th).stroke();
      doc.fillColor(mute).fontSize(7).text(new Date(`${d.d}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' }), x, y0 + chh + 2, { width: bw, align: 'center' }); });
    doc.fillColor(mute).fontSize(7).text('Calories per day (bar) vs that day\'s target (line); grey = not logged', x0, y0 + chh + 12);
    doc.x = 40; doc.y = y0 + chh + 24; doc.fontSize(10).fillColor(ink); }

  h2('Skills');
  const KEY = ['muscle_up', 'pullup_weighted', 'dip_weighted', 'fl_tuck', 'hs_free', 'lsit_tuck'];
  const lad = ladderProgress(ev).filter(l => KEY.includes(l.key));
  const unit = l => (l.unit === 'kg' ? ' kg' : l.unit === 's' ? ' s' : '');
  const sy = doc.y; doc.fontSize(9);
  lad.forEach((l, i) => doc.fillColor(l.done ? good : ink).text(safe(`${l.name}: ${l.best == null ? 'not tested yet' : `${l.best}${unit(l)}`} / ${l.target}${unit(l)}${l.done ? '  done' : ''}`),
    40 + (i % 2) * (W / 2), sy + Math.floor(i / 2) * 14, { width: W / 2 - 10 }));
  doc.x = 40; doc.y = sy + Math.ceil(lad.length / 2) * 14 + 2; doc.fontSize(10).fillColor(ink);

  h2('How I have tailored your plan');
  if (changes.length) changes.forEach(c => bullet(`${fmtD(c.date)} · ${c.area}: ${c.text}`));
  else bullet('No changes yet: the plan is working as written. I adjust only when your data says so.');

  doc.fillColor(mute).fontSize(7).text(`Private · generated ${fmtD(t)} by your coach`, 40, doc.page.height - 50, { width: W, align: 'center' });

  // Then vs now: only when this week has a progress photo and one is 4+ weeks older. Private, never on the dashboard.
  const pics = await thenAndNow(t).catch(() => null);
  if (pics) {
    doc.addPage();
    doc.fillColor(ink).font('Helvetica-Bold').fontSize(20).text('Then and now');
    doc.font('Helvetica').fontSize(10).fillColor(mute).text(safe(`${fmtD(pics.then.date)} vs ${fmtD(pics.now.date)} · ${pics.days} days apart`));
    const top = doc.y + 12, half = W / 2 - 8, hgt = doc.page.height - top - 90;
    try { doc.image(pics.then.buf, 40, top, { fit: [half, hgt], align: 'center' }); doc.image(pics.now.buf, 40 + W / 2 + 8, top, { fit: [half, hgt], align: 'center' }); } catch (e) { console.error('report photos', e); }
    doc.fillColor(mute).fontSize(7).text('Private · photos stay in your private store', 40, doc.page.height - 50, { width: W, align: 'center' });
  }
  doc.end(); await done;
  return Buffer.concat(chunks);
}

async function thenAndNow(t) {
  const all = await listPhotos(); if (all.length < 2) return null;
  const dateOf = p => p.split('/')[1].split('_')[0];
  const first = all[0], lastDate = dateOf(all.at(-1)), latest = all.find(p => dateOf(p) === lastDate);
  const days = Math.round((new Date(`${lastDate}T12:00:00Z`) - new Date(`${dateOf(first)}T12:00:00Z`)) / 864e5);
  if (days < 28 || lastDate < shift(t, -6)) return null;
  const [a, b] = await Promise.all([readPhoto(first), readPhoto(latest)]);
  return a && b ? { then: { date: dateOf(first), buf: a }, now: { date: lastDate, buf: b }, days } : null;
}
