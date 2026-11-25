// LEGACY (read-only use): the old Vercel Blob store, kept only to copy history into Postgres once its quota resets.
// Append-only event store on a PRIVATE Vercel Blob store (PRIVATE_BLOB_READ_WRITE_TOKEN):
// blobs can't be read by URL, only with the token. Every log entry is its own blob, so there
// are no overwrite races. Paths live under a secret prefix.
import { put, list, del, get } from '@vercel/blob';

const token = () => process.env.PRIVATE_BLOB_READ_WRITE_TOKEN;
const W = { access: 'private', addRandomSuffix: false, contentType: 'application/json' };
const write = (pathname, body, extra = {}) => put(pathname, body, { ...W, token: token(), ...extra });
async function read(pathname) {
  const r = await get(pathname, { access: 'private', token: token(), useCache: false });
  return r?.statusCode === 200 ? JSON.parse(await new Response(r.stream).text()) : null;
}
import { today } from './config.js';

const P = () => `t/${process.env.DATA_KEY}`;

export async function addEvent(type, data, date = today()) {
  const ts = Date.now();
  const month = date.slice(0, 7);
  const pathname = `${P()}/events/${month}/${date}_${ts}_${type}.json`;
  const body = JSON.stringify({ type, date, ts, ...data });
  const r = await write(pathname, body);
  invalidate();
  return { url: r.url, pathname, ts };
}

async function listAll(prefix) {
  const out = [];
  let cursor;
  do {
    const r = await list({ prefix, cursor, limit: 1000, token: token() });
    out.push(...r.blobs);
    cursor = r.hasMore ? r.cursor : undefined;
  } while (cursor);
  return out;
}

// Event blobs never change (an edit deletes and re-creates), so a warm instance keeps what it has read.
const blobCache = new Map();
async function fetchMany(blobs) {
  const res = [];
  for (let i = 0; i < blobs.length; i += 40) {
    const chunk = await Promise.all(blobs.slice(i, i + 40).map(async b => {
      if (blobCache.has(b.pathname)) return blobCache.get(b.pathname);
      const j = await read(b.pathname).catch(() => null);
      const ev = j && { ...j, _path: b.pathname };
      if (ev) blobCache.set(b.pathname, ev);
      return ev;
    }));
    res.push(...chunk.filter(Boolean));
  }
  return res.sort((a, b) => a.ts - b.ts);
}

const DEBUG_TYPES = ['inbound']; // message log for debugging: skipped by normal reads
const monthsBetween = (from, to) => { const out = []; for (let d = new Date(`${from.slice(0, 7)}-15T12:00:00Z`); d.toISOString().slice(0, 7) <= to.slice(0, 7); d.setUTCMonth(d.getUTCMonth() + 1)) out.push(d.toISOString().slice(0, 7)); return out; };
let memo = null; // short-lived: one chat message calls this several times
const invalidate = () => { memo = null; };

// Everyday read: the last `days` days only (chat, morning, evening, nudges), plus the saved all-time bests.
export async function recentDays(days = 21, { debug = false } = {}) {
  const key = `${days}|${debug}`;
  if (memo && memo.key === key && Date.now() - memo.at < 4000) return memo.value;
  const t = today(), from = today(new Date(Date.now() - (days - 1) * 864e5));
  const blobs = (await Promise.all(monthsBetween(from, t).map(m => listAll(`${P()}/events/${m}/`)))).flat()
    .filter(b => { const f = b.pathname.split('/').pop(); return f.slice(0, 10) >= from && (debug || !DEBUG_TYPES.some(x => f.endsWith(`_${x}.json`))); });
  const [events, bests] = await Promise.all([fetchMany(blobs), readDoc('bests')]);
  const value = bests ? [...events, { type: 'bests', date: '1970-01-01', ts: 0, values: bests.values || {} }] : events;
  memo = { key, at: Date.now(), value };
  return value;
}
// Kept for older call sites: everyday reads are the 21-day window.
export const recentEvents = () => recentDays(21);

// Full history (weekly review, dashboard): monthly archives + the live per-event files.
export async function allEvents({ debug = false } = {}) {
  const archives = await listAll(`${P()}/archive/`);
  const archived = (await Promise.all(archives.map(b => read(b.pathname).catch(() => [])))).flat().filter(Boolean)
    .map(e => ({ ...e, _archived: true }));
  const live = (await listAll(`${P()}/events/`)).filter(b => debug || !DEBUG_TYPES.some(x => b.pathname.endsWith(`_${x}.json`)));
  return [...archived, ...(await fetchMany(live))].sort((a, b) => a.ts - b.ts);
}

// Roll each finished month older than `keepDays` into one archive file, then delete its per-event files.
// Debug events (the message log) are dropped rather than archived.
export async function rollupMonths(keepDays = 21) {
  const cutoff = today(new Date(Date.now() - keepDays * 864e5)), done = [];
  const blobs = await listAll(`${P()}/events/`);
  const months = [...new Set(blobs.map(b => b.pathname.split('/events/')[1].slice(0, 7)))].sort();
  for (const m of months) {
    const last = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).toISOString().slice(0, 10);
    if (last >= cutoff) continue;
    const mine = blobs.filter(b => b.pathname.includes(`/events/${m}/`));
    const keep = mine.filter(b => !DEBUG_TYPES.some(x => b.pathname.endsWith(`_${x}.json`)));
    const events = (await fetchMany(keep)).map(({ _path, ...e }) => e);
    const path = `${P()}/archive/${m}.json`;
    const existing = (await read(path).catch(() => null)) || [];
    const merged = [...existing, ...events].sort((a, b) => a.ts - b.ts);
    await write(path, JSON.stringify(merged), { allowOverwrite: true });
    const check = await read(path);
    if (!Array.isArray(check) || check.length !== merged.length) throw new Error(`archive check failed for ${m}`);
    for (let i = 0; i < mine.length; i += 100) await del(mine.slice(i, i + 100).map(b => b.url), { token: token() });
    mine.forEach(b => blobCache.delete(b.pathname));
    done.push({ month: m, archived: events.length, deleted: mine.length });
  }
  invalidate();
  return done;
}

// Measurements are rare, so keep them under their own prefix and load all of them.
export async function addMeasurement(m) {
  const ts = Date.now();
  const body = JSON.stringify({ ...m, ts, source: 'bot' });
  await write(`${P()}/meas/${m.date}_${ts}.json`, body);
}
export async function allMeasurements() {
  return fetchMany(await listAll(`${P()}/meas/`));
}

export async function deleteLast() {
  const ev = (await recentDays(21)).filter(e => e._path);
  const meas = await allMeasurements();
  const last = [...ev, ...meas].sort((a, b) => b.ts - a.ts)[0];
  if (!last) return null;
  await deleteByPath(last._path);
  if (last.type === 'photo' && last.pathname) await deleteByPath(last.pathname);
  return last;
}

// Owner chat id is written once by /start and never overwritten.
export async function getOwner() {
  const { blobs } = await list({ prefix: `${P()}/owner/`, limit: 1, token: token() });
  if (!blobs[0]) return null;
  return (await read(blobs[0].pathname))?.chatId ?? null;
}
export async function setOwner(chatId) {
  await write(`${P()}/owner/owner.json`, JSON.stringify({ chatId }), { allowOverwrite: true });
}

export async function deleteByPath(pathname) {
  const { blobs } = await list({ prefix: pathname, limit: 1, token: token() });
  if (blobs[0]) await del(blobs[0].url, { token: token() });
  blobCache.delete(pathname); invalidate();
}

// Small mutable documents (e.g. the coach's profile of you), overwritten in place.
export async function readDoc(name) {
  try { return await read(`${P()}/docs/${name}.json`); } catch { return null; }
}
export async function writeDoc(name, obj) {
  await write(`${P()}/docs/${name}.json`, JSON.stringify(obj), { allowOverwrite: true });
}

// Progress photos: binary JPEGs in the private store, never public, never on the dashboard.
export async function savePhoto(date, buf) {
  const pathname = `${P()}/photos/${date}_${Date.now()}.jpg`;
  await put(pathname, buf, { access: 'private', token: token(), addRandomSuffix: false, contentType: 'image/jpeg' });
  return pathname;
}
export async function readPhoto(pathname) {
  const r = await get(pathname, { access: 'private', token: token(), useCache: false });
  return r?.statusCode === 200 ? Buffer.from(await new Response(r.stream).arrayBuffer()) : null;
}
export async function listPhotos() {
  return (await listAll(`${P()}/photos/`)).map(b => b.pathname).sort();
}
export async function deletePhotos() {
  const blobs = await listAll(`${P()}/photos/`);
  for (let i = 0; i < blobs.length; i += 100) await del(blobs.slice(i, i + 100).map(b => b.url), { token: token() });
  return blobs.length;
}

// Telegram re-sends a message if the bot is slow to answer; this makes each message count once.
// Returns false if the key was already seen.
export async function markSeen(key) {
  try {
    await put(`${P()}/seen/${key}.json`, '1', { access: 'private', token: token(), addRandomSuffix: false, allowOverwrite: false, contentType: 'application/json' });
    return true;
  } catch (e) {
    return !/exist/i.test(String(e?.message || e));
  }
}
