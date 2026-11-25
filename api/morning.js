// Morning ping, triggered by Vercel Cron (05:30 UTC = 07:30 Cairo; on Hobby it fires within that hour).
// One simple message: the check-in ask, with a wood tap. Everything else follows the check-in.
import { authed } from '../lib/auth.js';
import { writeDoc } from '../lib/store.js';
import { recentEvents, getOwner } from '../lib/store.js';
import { send } from '../lib/tg.js';
import { morningPing, checkinButtons } from '../lib/templates.js';
import { dayRecovery } from '../lib/recovery.js';
import { today } from '../lib/config.js';

export default async function handler(req, res) {
  if (!authed(req, { cron: true })) return res.status(401).send('no');
  const owner = await getOwner();
  if (!owner) return res.send('no owner yet');
  const ev = await recentEvents();
  const r = dayRecovery(ev, today());
  const msg = morningPing(ev);
  if (req.query.dry) return res.send(msg);
  await writeDoc('last_prompt', { kind: 'checkin', ts: Date.now() });
  await send(owner, msg, { markup: r.wood == null ? checkinButtons({}) : undefined });
  res.send('sent');
}
