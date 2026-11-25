import { authed } from '../lib/auth.js';
// Maintenance: replace one day's food entries with an exact list (used to repair a bad day by hand).
// POST /api/admin (header x-dashboard-key)  { "action": "set_food", "date": "YYYY-MM-DD", "meals": [ ... ] }
import { recentEvents, addEvent, deleteByPath, rollupMonths } from '../lib/store.js';
import { getEquipment, adaptToPlace, norm } from '../lib/equipment.js';
import { parseText } from './telegram.js';
import { refreshToday } from '../lib/today.js';
import { getOwner } from '../lib/store.js';
import { remember } from '../lib/persona.js';

export default async function handler(req, res) {
  if (!authed(req)) return res.status(401).json({ error: 'send the key in the x-dashboard-key header' });
  if (req.query.report) { // build the PDF; ?report=send also sends it to him
    const { buildReport, solidWeek } = await import('../lib/report.js'), { allMeasurements } = await import('../lib/store.js'), { allMeas } = await import('../lib/summary.js');
    const ev = await recentEvents(), pdf = await buildReport(ev, allMeas(await allMeasurements()));
    if (req.query.report === 'send') { const { sendDocument } = await import('../lib/tg.js'); const r = await sendDocument(await getOwner(), pdf, `week-${new Date().toISOString().slice(0, 10)}.pdf`, '📄 Your week on one page.', { silent: true }); return res.json({ sent: r.ok, bytes: pdf.length, solid: solidWeek(ev) }); }
    res.setHeader('content-type', 'application/pdf'); return res.send(pdf);
  }
  if (req.query.import_legacy) { // one-time: copy the old Blob history into Postgres (works once the Blob quota resets)
    const legacy = await import('../lib/blobstore.js'), store = await import('../lib/store.js');
    let ev, meas;
    try { [ev, meas] = await Promise.all([legacy.allEvents({ debug: true }), legacy.allMeasurements()]); }
    catch (e) { return res.json({ imported: false, reason: 'old Blob store still locked (quota)', detail: String(e.message || e).slice(0, 120) }); }
    if (!ev.length) return res.json({ imported: false, reason: 'old Blob store still locked (files listed, but reads refused)' });
    const out = await store.importLegacy(ev, meas);
    for (const name of ['profile', 'equipment', 'bests']) { const d = await legacy.readDoc(name); if (d) await store.writeDoc(name, d); }
    const owner = await legacy.getOwner().catch(() => null); if (owner && !(await store.getOwner())) await store.setOwner(owner);
    return res.json({ ...out, read: { events: ev.length, measurements: meas.length } });
  }
  if (req.query.refresh_today) { await refreshToday(await getOwner()); return res.json({ ok: true }); } // create/update the pinned Today message
  if (req.query.voice_test) { // speak a short line, convert, and send it as a silent voice note
    const { speak } = await import('../lib/voice.js'), { sendVoice } = await import('../lib/tg.js');
    const a = await speak('Test of your evening voice note. From tonight, the recap comes as audio too.');
    if (!a) return res.json({ ok: false, note: 'voice unavailable' });
    const r = await sendVoice(await getOwner(), a.buf, 'Test of the evening voice note', { silent: true, format: a.format });
    return res.json({ ok: r.ok, format: a.format, bytes: a.buf.length, telegram: r.ok ? 'accepted' : r.description });
  }
  if (req.query.tts_test) { // which audio formats the speech model returns
    const out = {};
    for (const f of ['mp3', 'ogg', 'opus', 'wav']) {
      const r = await fetch('https://api.groq.com/openai/v1/audio/speech', { method: 'POST', headers: { authorization: `Bearer ${process.env.GROQ_API_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'canopylabs/orpheus-v1-english', voice: req.query.voice || 'troy', input: 'Morning. Low day today, protein first.', response_format: f }) });
      out[f] = r.ok ? { type: r.headers.get('content-type'), bytes: (await r.arrayBuffer()).byteLength } : { error: (await r.text()).slice(0, 200) };
    }
    return res.json(out);
  }
  if (req.query.groq_models) { // which speech models this Groq key can use (for the morning audio)
    const j = await fetch('https://api.groq.com/openai/v1/models', { headers: { authorization: `Bearer ${process.env.GROQ_API_KEY}` } }).then(r => r.json());
    return res.json((j.data || []).map(m => m.id).filter(id => /tts|speech|playai|orpheus|voice/i.test(id)));
  }
  if (req.query.rollup) return res.json(await rollupMonths(Number(req.query.keep) || 21)); // also runs every Sunday
  if (req.query.log || req.query.misreads) { // conversation log (in/out) or just the misread signals with context, last N days
    const { debugLog } = await import('../lib/store.js');
    const ev = await debugLog(Number(req.query.log || req.query.misreads) || 7);
    const row = e => ({ at: new Date(e.ts).toISOString().slice(5, 16), [e.type]: e.text ?? e.signal, ...(e.kinds ? { read_as: e.kinds } : {}), ...(e.detail ? { detail: e.detail } : {}), ...(e.after ? { after: e.after } : {}) });
    return res.json(req.query.log ? ev.map(row) : ev.filter(e => e.type === 'misread').map(row));
  }
  if (req.query.parse) { const r = (await parseText(req.query.parse)).entries; if (!req.query.usage) return res.json(r); const { lastUsage } = await import('../lib/claude.js'); return res.json({ entries: r, usage: lastUsage }); } // how a message would be read; nothing is logged
  if (req.query.preview_place) { // GET ?preview_place=home&session=B → the rewrite, not stored
    const ev = (await recentEvents(2)).concat(req.query.session ? [{ type: 'workout', session: { A: 'D', B: 'A', C: 'B', D: 'C' }[req.query.session], date: '2000-01-01', ts: 1, exercises: [] }] : []);
    return res.json(await adaptToPlace(ev, req.query.preview_place, (await getEquipment())[norm(req.query.preview_place)] || [], undefined, { dry: true, request: req.query.request || null }));
  }
  if (req.method === 'POST' && req.body?.action === 'set_last_prompt') { const { writeDoc } = await import('../lib/store.js'); await writeDoc('last_prompt', { kind: req.body.kind, ts: Date.now() }); return res.json({ ok: true }); }
  if (req.method === 'POST' && req.body?.action === 'redate') { // move one event to another date
    const { recentEvents, deleteByPath, addEvent } = await import('../lib/store.js');
    const e = (await recentEvents()).find(x => x._path === req.body.path); if (!e) return res.json({ error: 'not found' });
    const { _path, type, ts, date, ...rest } = e; await deleteByPath(_path); await addEvent(type, rest, req.body.date); return res.json({ moved: type, to: req.body.date });
  }
  if (req.method === 'POST' && req.body?.action === 'add') { const { addEvent } = await import('../lib/store.js'); return res.json(await addEvent(req.body.type, req.body.data || {}, req.body.date)); }
  if (req.method === 'POST' && req.body?.action === 'remember') { for (const f of req.body.facts || []) await remember(f); return res.json({ saved: (req.body.facts || []).length }); }
  if (req.method === 'POST' && req.body?.action === 'drop_exercise') { // remove one exercise from a day's logged workouts
    const { date, plan_id } = req.body; let n = 0;
    for (const w of (await recentEvents(2)).filter(e => e.type === 'workout' && e.date === date && (e.exercises || []).some(x => x.plan_id === plan_id))) {
      const { _path, type, ts, ...rest } = w; await deleteByPath(_path);
      const ex = w.exercises.filter(x => x.plan_id !== plan_id); n += w.exercises.length - ex.length;
      if (ex.length) await addEvent('workout', { ...rest, exercises: ex, edited: true }, date);
    }
    return res.json({ removed: n });
  }
  if (req.method !== 'POST' || req.body?.action !== 'set_food') return res.status(400).json({ error: 'POST {action:"set_food", date, meals}' });
  const { date, meals } = req.body;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Array.isArray(meals)) return res.status(400).json({ error: 'bad date or meals' });
  const old = (await recentEvents(2)).filter(e => e.type === 'food' && e.date === date);
  for (const e of old) await deleteByPath(e._path);
  for (const m of meals) await addEvent('food', { ...m, from: m.from || 'manual_fix', corrected: true }, date);
  res.json({ removed: old.length, added: meals.length, kcal: meals.reduce((t, m) => t + (m.total?.kcal || 0), 0) });
}
