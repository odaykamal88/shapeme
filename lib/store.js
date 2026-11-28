// Storage on Postgres (Neon, via the Vercel Marketplace: DATABASE_URL). One row per event; one query per read.
// Same functions as the old Blob store (lib/blobstore.js, kept for the one-time history import).
import { neon } from '@neondatabase/serverless';
import { today } from './config.js';

let _sql = null, _ready = null;
const db = () => (_sql ||= neon(process.env.DATABASE_URL || process.env.POSTGRES_URL));
const q = async (text, params = []) => { await ready(); return db().query(text, params); };

// Tables are created on first use, once per instance.
function ready() {
  return (_ready ||= (async () => {
    const sql = db();
    await sql.query(`CREATE TABLE IF NOT EXISTS events (id BIGSERIAL PRIMARY KEY, type TEXT NOT NULL, date DATE NOT NULL, ts BIGINT NOT NULL, data JSONB NOT NULL)`);
    await sql.query(`CREATE INDEX IF NOT EXISTS events_date ON events (date)`);
    await sql.query(`CREATE TABLE IF NOT EXISTS measurements (id BIGSERIAL PRIMARY KEY, date DATE NOT NULL, ts BIGINT NOT NULL, data JSONB NOT NULL)`);
    await sql.query(`CREATE TABLE IF NOT EXISTS docs (name TEXT PRIMARY KEY, data JSONB NOT NULL, updated BIGINT NOT NULL)`);
    await sql.query(`CREATE TABLE IF NOT EXISTS seen (key TEXT PRIMARY KEY, ts BIGINT NOT NULL)`);
    await sql.query(`CREATE TABLE IF NOT EXISTS photos (id BIGSERIAL PRIMARY KEY, date DATE NOT NULL, ts BIGINT NOT NULL, b64 TEXT NOT NULL)`);
  })().catch(e => { _ready = null; throw e; }));
}

const DEBUG_TYPES = ['inbound', 'outbound', 'misread', 'api_usage']; // conversation log for debugging: skipped by normal reads

// The conversation log (what he sent, what the bot said, misread signals) for the last `days` days, oldest first.
// Estimated API spend (USD) today, from the `api_usage` log written by lib/claude.js.
export async function spentToday() {
  const [r] = await q(`SELECT COALESCE(SUM((data->>'usd')::numeric), 0) AS usd FROM events WHERE type = 'api_usage' AND date = $1`, [today()]);
  return Number(r?.usd || 0);
}
export async function debugLog(days = 7) {
  const from = today(new Date(Date.now() - (days - 1) * 864e5));
  return (await q(`SELECT id, data FROM events WHERE date >= $1 AND type = ANY($2) ORDER BY ts`, [from, DEBUG_TYPES])).map(toEvent);
}
const toEvent = r => ({ ...r.data, _path: `ev/${r.id}` });

export async function addEvent(type, data, date = today()) {
  const ts = Date.now(), body = { type, date, ts, ...data };
  const [r] = await q(`INSERT INTO events (type, date, ts, data) VALUES ($1, $2, $3, $4) RETURNING id`, [type, date, ts, JSON.stringify(body)]);
  return { pathname: `ev/${r.id}`, ts };
}

// Everyday read: the last `days` days, plus the saved all-time bests as a synthetic event.
export async function recentDays(days = 21, { debug = false } = {}) {
  const from = today(new Date(Date.now() - (days - 1) * 864e5));
  const [rows, bests] = await Promise.all([
    q(`SELECT id, data FROM events WHERE date >= $1 ${debug ? '' : `AND type <> ALL($2)`} ORDER BY ts`, debug ? [from] : [from, DEBUG_TYPES]),
    readDoc('bests')
  ]);
  const events = rows.map(toEvent);
  return bests ? [...events, { type: 'bests', date: '1970-01-01', ts: 0, values: bests.values || {} }] : events;
}
export const recentEvents = () => recentDays(21);

export async function allEvents({ debug = false } = {}) {
  const rows = await q(`SELECT id, data FROM events ${debug ? '' : `WHERE type <> ALL($1)`} ORDER BY ts`, debug ? [] : [DEBUG_TYPES]);
  return rows.map(toEvent);
}

// No longer needed (one table, indexed by date); kept so callers don't change.
export async function rollupMonths() { return []; }

export async function addMeasurement(m) {
  const ts = Date.now();
  await q(`INSERT INTO measurements (date, ts, data) VALUES ($1, $2, $3)`, [m.date, ts, JSON.stringify({ ...m, ts, source: m.source || 'bot' })]);
}
export async function allMeasurements() {
  return (await q(`SELECT id, data FROM measurements ORDER BY ts`)).map(r => ({ ...r.data, _path: `meas/${r.id}` }));
}

export async function deleteByPath(pathname) {
  const [kind, id] = String(pathname).split('/');
  if (kind === 'ev') await q(`DELETE FROM events WHERE id = $1`, [id]);
  else if (kind === 'meas') await q(`DELETE FROM measurements WHERE id = $1`, [id]);
  else if (kind === 'photo') await q(`DELETE FROM photos WHERE id = $1`, [String(id).split('_').pop()]);
}

export async function deleteLast() {
  const [ev] = await q(`SELECT id, data FROM events WHERE type <> ALL($1) ORDER BY ts DESC LIMIT 1`, [[...DEBUG_TYPES, 'coach_log', 'week_plan', 'routine_plan', 'diet_tweak', 'diet_plan', 'habit_tips', 'weekly_recap']]);
  const [me] = await q(`SELECT id, data FROM measurements ORDER BY ts DESC LIMIT 1`);
  const last = [ev && { ...ev.data, _path: `ev/${ev.id}` }, me && { ...me.data, _path: `meas/${me.id}` }].filter(Boolean).sort((a, b) => b.ts - a.ts)[0];
  if (!last) return null;
  await deleteByPath(last._path);
  if (last.type === 'photo' && last.pathname) await deleteByPath(last.pathname);
  return last;
}

export async function getOwner() { return (await readDoc('owner'))?.chatId ?? null; }
export async function setOwner(chatId) { await writeDoc('owner', { chatId }); }

export async function readDoc(name) {
  try { const [r] = await q(`SELECT data FROM docs WHERE name = $1`, [name]); return r ? r.data : null; } catch { return null; }
}
export async function writeDoc(name, obj) {
  await q(`INSERT INTO docs (name, data, updated) VALUES ($1, $2, $3) ON CONFLICT (name) DO UPDATE SET data = EXCLUDED.data, updated = EXCLUDED.updated`, [name, JSON.stringify(obj), Date.now()]);
}

// Telegram re-sends a message if the bot is slow; each key counts once. Returns false if already seen.
export async function markSeen(key) {
  const rows = await q(`INSERT INTO seen (key, ts) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING RETURNING key`, [key, Date.now()]);
  return rows.length > 0;
}

// Progress photos: private, in the database, never on the dashboard. Path keeps the date first ("photo/<date>_<id>").
export async function savePhoto(date, buf) {
  const [r] = await q(`INSERT INTO photos (date, ts, b64) VALUES ($1, $2, $3) RETURNING id`, [date, Date.now(), buf.toString('base64')]);
  return `photo/${date}_${r.id}`;
}
export async function readPhoto(pathname) {
  const [r] = await q(`SELECT b64 FROM photos WHERE id = $1`, [String(pathname).split('_').pop()]);
  return r ? Buffer.from(r.b64, 'base64') : null;
}
export async function listPhotos() {
  return (await q(`SELECT id, to_char(date, 'YYYY-MM-DD') AS d FROM photos ORDER BY ts`)).map(r => `photo/${r.d}_${r.id}`);
}
export async function deletePhotos() {
  const r = await q(`DELETE FROM photos RETURNING id`);
  return r.length;
}

// One-time import of the old Blob history (run once its quota resets). Idempotent: skips events already present.
export async function importLegacy(events, measurements) {
  const have = new Set((await q(`SELECT (data->>'ts')::bigint AS ts, type FROM events`)).map(r => `${r.type}|${r.ts}`));
  let n = 0;
  for (const e of events) {
    const { _path, _archived, ...body } = e;
    if (!body.type || !body.date || have.has(`${body.type}|${body.ts}`)) continue;
    have.add(`${body.type}|${body.ts}`);
    await q(`INSERT INTO events (type, date, ts, data) VALUES ($1, $2, $3, $4)`, [body.type, body.date, body.ts || Date.now(), JSON.stringify(body)]); n++;
  }
  const haveM = new Set((await q(`SELECT (data->>'ts')::bigint AS ts FROM measurements`)).map(r => String(r.ts)));
  let m = 0;
  for (const x of measurements) { const { _path, ...body } = x; if (!body.date || haveM.has(String(body.ts))) continue; haveM.add(String(body.ts)); await q(`INSERT INTO measurements (date, ts, data) VALUES ($1, $2, $3)`, [body.date, body.ts || Date.now(), JSON.stringify(body)]); m++; }
  return { events: n, measurements: m };
}
