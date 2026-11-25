// Equipment per place, and rewriting a gym session for a place without a gym.
// Lists live in the private store (`docs/equipment.json`); "home" is seeded from what he told the coach.
import { readDoc, writeDoc, addEvent } from './store.js';
import { ask } from './claude.js';
import { ADAPT } from './schemas.js';
import { getProfile, personaPrompt } from './persona.js';
import { sessionFor, homeFor, PARSER_CATALOG, programmeCoverage } from './plan.js';
import { lastPerformance, fmtSets } from './training.js';
import { today } from './config.js';

const SEED = {
  home: ['sliders', 'steel clubs 6 kg and 8 kg', 'pull-up bar', 'parallettes', 'jump rope', '18 L water gallon bottles (~18 kg each, bulky, held by the neck): ONLY for farmer\'s carries and grip holds', 'rucksack 5 kg (fixed load; the water gallons do not fit in it)',
    'resistance bands: 2 heavy + 1 light (loop bands)', 'ONE cable/tube band with a handle and a door anchor: single-arm cable work only, one anchor point at a time']
};
export const shiftD = (d, n) => new Date(new Date(`${d}T12:00:00Z`).getTime() + n * 864e5).toISOString().slice(0, 10);
export const norm = w => String(w || 'home').toLowerCase().replace(/^(my|the|at)\s+/g, '').replace(/['’]s?\b/g, '').trim() || 'home';

// Seeded items always stay in the home list, so additions to the seed reach a saved list too.
export async function getEquipment() {
  const saved = (await readDoc('equipment')) || {};
  const home = (saved.home || []).filter(x => !/water jug|water gallon|rucksack 5 kg|resistance bands|cable\/tube band/i.test(x)); // seed wording wins for these items
  return { ...SEED, ...saved, home: [...new Set([...SEED.home, ...home])] };
}

export async function saveEquipment(where, items) {
  const all = await getEquipment(), key = norm(where);
  const merged = [...new Set([...(all[key] || []), ...items.map(s => s.trim()).filter(Boolean)])];
  await writeDoc('equipment', { ...all, [key]: merged });
  return { key, items: merged };
}

export function equipmentMessage(all) {
  return `🧰 <b>Your equipment</b>\n\n${Object.entries(all).map(([k, v]) => `<b>${k}</b>: ${v.join(', ')}`).join('\n\n')}\n\n<i>Add to a list: "at my parents' I have dumbbells 10–20 kg". Use it: "no gym today, training at home".</i>`;
}

// Rewrite the day's gym session for the equipment at `where`; stored as a one-day adjusted plan.
export async function adaptToPlace(events, where, items, date = today(), { dry = false, request = null } = {}) {
  const s = sessionFor(date, events);
  const session = s.exercises.map(e => {
    const last = e.id ? lastPerformance(events, e.id) : null;
    return `${e.id}: ${e.name} ${e.target}${last ? ` (last ${fmtSets(last)})` : ''}${e.circuit ? ` [${e.circuit.map(c => c.name).join(', ')}]` : ''}`;
  }).join('\n');
  const out = await ask({
    system: `${personaPrompt(await getProfile(), events)}
Rewrite today's gym session for a place without a gym, using ONLY the equipment listed (plus bodyweight, a wall, a chair, a sofa, stairs). The single cable band stands in for the gym's cable work, ONE ARM AT A TIME from one anchor point (single-arm crossover/fly, single-arm lateral raise, single-arm pushdown and overhead extension, single-arm face pull or row); never prescribe two handles or two anchors at once, and write "single-arm" with "/side" targets. The loop bands (2 heavy, 1 light) add resistance to pull-ups, dips, push-ups and hip thrusts, or assist muscle-ups; at most 2 heavy bands in any one exercise. Keep the session's purpose: same muscle groups and roughly the same hard sets, the skill work (muscle-up, front lever, L-sit, planche, handstand) whenever the equipment allows, and enough challenge: load with the steel clubs (6/8 kg), the 5 kg rucksack and heavy bands; the water gallons are ONLY for farmer's carries and grip holds (never in the rucksack, never for rows, RDLs, squats, hip thrusts or curls; always say "water gallon", never "jug"), slow 3–4 s lowering, pauses, single-leg and unilateral variants, higher reps close to failure. Respect the knee rule (pain ≤ 3/10) and the block note. Return exactly one day for ${date}: name = "${s.key} — <short focus> (${norm(where)} version)", changed true, reason = ≤ 12 words on what replaced what. Exercises in session order, 5–9 of them; keep the gym plan_id where the movement is the same, else plan_id null. target like "4 × 6–8" or "3 × 30 s"; mention the load in the name when used (e.g. "Rucksack pull-ups (5 kg)", "Band-resisted hip thrust"). cue: only where a mistake is likely, ≤ 7 words, else empty. summary: one line on how this keeps the training effect.`,
    content: `${request ? `HIS REQUEST FOR THIS VERSION: ${request}\nBefore adding anything, check WEEKLY COVERAGE and what comes next: a muscle group already trained elsewhere this week gets at most a small finisher here (and only if the next session doesn't hit it hard); say in summary where it's covered. Real gaps (e.g. direct trap work) can be added. Keep the session ≤ 70 min by trimming the least important accessory if you add.\n\n` : ''}WEEKLY COVERAGE: ${programmeCoverage()}\nNEXT SESSIONS: gym ${sessionFor(shiftD(date, 1), events).name}; home ${homeFor(shiftD(date, 1), events).name}\n\nSession ${s.name}${s.block?.note ? ` (block note: ${s.block.note})` : ''}:\n${session}\n\nEquipment at ${norm(where)}: ${items.join('; ')}\n\nCatalog (plan_id: name):\n${PARSER_CATALOG}`,
    maxTokens: 8000, schema: ADAPT, effort: 'medium'
  });
  const day = (out.days || [])[0];
  if (!day) throw new Error('Could not build the home version; try again.');
  // One cable band, one anchor: every cable-style band move is single-arm, per side.
  if (items.some(i => /ONE cable/i.test(i))) day.exercises = day.exercises.map(e => {
    if (!/(crossover|fly|lateral|pushdown|extension|face pull|row|pulldown)/i.test(e.name) || !/(band|cable)/i.test(e.name)) return e;
    const name = /single/i.test(e.name) ? e.name : e.name.replace(/^(\+ |Superset: )?(.)/i, (m, pre = '', c) => `${pre}Single-arm ${c.toLowerCase()}`);
    return { ...e, name, target: /side/.test(e.target) ? e.target : `${e.target}/side` };
  });
  day.date = date; day.changed = true;
  if (dry) return { day, summary: out.summary, key: s.key };
  await addEvent('week_plan', { summary: out.summary, days: [day], why: `training at ${norm(where)}`, where: norm(where), key: s.key });
  return { day, summary: out.summary, key: s.key };
}
