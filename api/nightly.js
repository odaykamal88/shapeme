// Nightly self-improvement loop, triggered by Vercel Cron (21:30 UTC = 23:30 Cairo; Hobby fires within that hour). Silent.
// Manual: GET /api/nightly?dry=1 with the x-dashboard-key header previews the review without applying it.
import { authed } from '../lib/auth.js';
import { nightlyImprove } from '../lib/improve.js';
import { getOwner, readDoc, writeDoc, importLegacy, setOwner } from '../lib/store.js';

export default async function handler(req, res) {
  if (!authed(req, { cron: true })) return res.status(401).send('no');
  if (!(await getOwner())) return res.send('no owner yet');
  // One-time: copy the old Blob history into Postgres as soon as the Blob quota resets (tries nightly until it works).
  let imported = null;
  if (!(await readDoc('legacy_imported'))) {
    try {
      const legacy = await import('../lib/blobstore.js');
      const [ev, meas] = await Promise.all([legacy.allEvents({ debug: true }), legacy.allMeasurements()]);
      if (ev.length) {
        imported = await importLegacy(ev, meas);
        for (const name of ['profile', 'equipment', 'bests']) { const d = await legacy.readDoc(name); if (d) await writeDoc(name, d); }
        const owner = await legacy.getOwner().catch(() => null); if (owner && !(await getOwner())) await setOwner(owner);
        await writeDoc('legacy_imported', { at: Date.now(), ...imported });
      }
    } catch (e) { console.error('legacy import not possible yet:', String(e.message || e).slice(0, 120)); }
  }
  // Spend guard: the review runs only when something new was logged since the last one, and within the day's budget.
  if (req.query.dry !== '1') {
    const { recentEvents } = await import('../lib/store.js'), { overBudget } = await import('../lib/claude.js');
    const ev = await recentEvents(), last = ev.filter(e => e.type === 'coach_log').pop()?.ts || 0;
    const fresh = ev.some(e => e.ts > last && ['food', 'workout', 'workout_skip', 'recovery', 'steps', 'routine', 'photo'].includes(e.type));
    if (!fresh) return res.json({ skipped: 'nothing new since the last review', imported });
    if (await overBudget()) return res.json({ skipped: 'daily AI budget reached', imported });
  }
  const out = await nightlyImprove({ dry: req.query.dry === '1' });
  res.json(req.query.dry === '1' ? out : { applied: out.applied, focus: out.focus, imported });
}
