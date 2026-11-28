// Progress-photo comparison, only when you send /compare. Photos are read from the private store and sent
// to Claude for this one analysis; nothing is stored anywhere else.
import { listPhotos, readPhoto } from './store.js';
import { ask } from './claude.js';
import { allMeas } from './summary.js';
import { getProfile, personaPrompt } from './persona.js';
import { BODYFAT } from './schemas.js';
import { readDoc, writeDoc } from './store.js';
import { CONFIG } from './config.js';

const dateOf = p => p.split('/').pop().slice(0, 10);

export async function compareProgress(events, rawMeas) {
  const photos = await listPhotos();
  if (!photos.length) return '📸 No progress photos yet. Send front, side and back with the caption <i>progress</i>.';
  const dates = [...new Set(photos.map(dateOf))].sort();
  const latest = dates.at(-1);
  // Previous set: the most recent session at least 10 days earlier, else the first one.
  const prev = [...dates].reverse().find(d => d !== latest && (new Date(latest) - new Date(d)) / 864e5 >= 10) || (dates[0] !== latest ? dates[0] : null);
  const pick = d => photos.filter(p => dateOf(p) === d).slice(-3);
  const img = async p => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: (await readPhoto(p)).toString('base64') } });

  const meas = allMeas(rawMeas);
  const near = d => [...meas].reverse().find(m => m.date <= d && (m.waist || m.weight)) || null;
  const content = [
    { type: 'text', text: `Latest set (${latest}), measurements near then: ${JSON.stringify(near(latest))}` },
    ...(await Promise.all(pick(latest).map(img)))
  ];
  if (prev) content.push({ type: 'text', text: `Previous set (${prev}), measurements near then: ${JSON.stringify(near(prev))}` }, ...(await Promise.all(pick(prev).map(img))));
  content.push({ type: 'text', text: prev ? 'Compare the two sets.' : 'This is his first set: give a baseline read.' });

  const text = await ask({
    system: `${personaPrompt(await getProfile(), events)}
These are his own progress photos, shared privately for physique feedback. Give an honest, specific read in under 120 words: visible changes in waist and midsection, shoulders and V-taper, arms, overall leanness, tied to his goals and the tape numbers given. Note if lighting, pose or pump differ enough to mislead. Say nothing about face or identity. End with one focus for the next two weeks.`,
    content, maxTokens: 4000, effort: 'medium'
  });
  return `📸 <b>Progress check</b> (${prev ? `${prev.slice(5)} → ${latest.slice(5)}` : `baseline ${latest.slice(5)}`})\n\n${text}`;
}

// Body-fat estimate from a day's progress photos (+ weight, waist, height), for the resting-burn formula (lean mass →
// Katch-McArdle in lib/energy.js). Runs from the nightly job once per photo day. A visual estimate: kept as a range.
export async function estimateBodyFat(date, rawMeas) {
  const photos = (await listPhotos()).filter(p => dateOf(p) === date).slice(-3);
  if (!photos.length) return null;
  const meas = allMeas(rawMeas), near = [...meas].reverse().find(m => m.date <= date && (m.waist || m.weight)) || null;
  const body = { ...CONFIG.body, ...((await readDoc('body')) || {}) };
  const imgs = await Promise.all(photos.map(async p => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: (await readPhoto(p)).toString('base64') } })));
  const out = await ask({
    system: `These are a man's own private progress photos (age ${body.age}, height ${body.heightCm || 'unknown'} cm). Estimate his body-fat percentage as a narrow range (at most 4 points wide) from visible muscle definition, waist and midsection, and the measurements given. Be conservative and realistic; photos with flattering light or a pump read leaner than reality. basis: ≤ 15 words on what you judged from. Say nothing about face or identity.`,
    content: [{ type: 'text', text: `Measurements near ${date}: ${JSON.stringify(near)}; latest weight ${body.weight} kg.` }, ...imgs],
    maxTokens: 2000, schema: BODYFAT, effort: 'medium', tag: 'bodyfat'
  });
  const low = Math.max(5, Math.min(40, out.low)), high = Math.max(low, Math.min(40, out.high));
  const bodyFat = { low, high, pct: +((low + high) / 2).toFixed(1), date, confidence: out.confidence, basis: out.basis };
  await writeDoc('body', { ...((await readDoc('body')) || {}), bodyFat });
  return bodyFat;
}

