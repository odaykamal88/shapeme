import { authed } from '../lib/auth.js';
// One-time: GET https://<your-app>/api/setup with header x-dashboard-key: <DASHBOARD_KEY> to point Telegram at this app.
import { setWebhook, webhookInfo, setCommands, send } from '../lib/tg.js';
import { getOwner } from '../lib/store.js';

export default async function handler(req, res) {
  if (!authed(req)) return res.status(401).json({ error: 'send the key in the x-dashboard-key header' });
  const missing = ['TELEGRAM_BOT_TOKEN', 'ANTHROPIC_API_KEY', 'WEBHOOK_SECRET', 'DASHBOARD_KEY', 'DATA_KEY', 'PRIVATE_BLOB_READ_WRITE_TOKEN'].filter(k => !process.env[k]);
  if (missing.length) return res.status(500).json({ missing });
  const url = `https://${req.headers.host}/api/telegram`;
  const r = await setWebhook(url, process.env.WEBHOOK_SECRET);
  // Simplicity: the menu shows only what earns a daily place. Every other command still works if typed (see /help).
  await setCommands([
    ['workout', "Today's session"], ['today', "Today's food and what's left"], ['undo', 'Remove the last entry'], ['help', 'How to use me']
  ].map(([command, description]) => ({ command, description })));
  const owner = await getOwner();
  if (owner && req.query.keyboard === '1') await send(owner, '⌨️ Shortcuts are on the keyboard below. Type / for every command.', { silent: true,
    markup: { keyboard: [[{ text: '🏋️ Workout' }, { text: '📋 Today' }], [{ text: '✍️ Check-in' }, { text: '↩️ Undo' }]], resize_keyboard: true, is_persistent: true } });
  const info = (await webhookInfo()).result || {};
  res.json({ webhook: url, telegram: r, allowed_updates: info.allowed_updates, pending: info.pending_update_count, last_error: info.last_error_message || null, next: 'Open your bot in Telegram and send /start' });
}
