// Telegram Bot API helpers. Every text goes through the formatter; if Telegram rejects the markup, it is resent as plain text.
import { toTelegramHTML, stripTags, chunks } from './format.js';
import { addEvent } from './store.js';

// Every message the bot sends or edits is logged (`outbound`, a debug type normal reads skip) so misreads can be traced.
const logOut = (text, extra = {}) => addEvent('outbound', { text: stripTags(toTelegramHTML(String(text))).slice(0, 800), ...extra }).catch(() => {});

export const api = (method, body) =>
  fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
  }).then(r => r.json());

// Inline buttons: rows of [label, callback_data]. Keep callback_data under 64 bytes.
export const buttons = rows => ({ inline_keyboard: rows.map(r => r.map(([text, data]) => ({ text, callback_data: data }))) });

// opts: silent (no buzz), markup (reply_markup), replyTo (message id).
export async function send(chat_id, text, opts = {}) {
  let r;
  const parts = chunks(toTelegramHTML(text));
  for (let i = 0; i < parts.length; i++) {
    const extra = { disable_web_page_preview: true, ...(opts.silent ? { disable_notification: true } : {}),
      ...(opts.replyTo ? { reply_parameters: { message_id: opts.replyTo, allow_sending_without_reply: true } } : {}),
      ...(opts.markup && i === parts.length - 1 ? { reply_markup: opts.markup } : {}) };
    r = await api('sendMessage', { chat_id, text: parts[i], parse_mode: 'HTML', ...extra });
    if (!r.ok && /parse|entit|tag/i.test(r.description || '')) r = await api('sendMessage', { chat_id, text: stripTags(parts[i]), ...extra });
  }
  if (r?.ok) await logOut(text, opts.markup?.inline_keyboard ? { buttons: opts.markup.inline_keyboard.flat().map(b => b.text).slice(0, 8) } : {});
  return r;
}
export async function edit(chat_id, message_id, text, markup = undefined) {
  const body = { chat_id, message_id, text: toTelegramHTML(text).slice(0, 4000), parse_mode: 'HTML', disable_web_page_preview: true, ...(markup !== undefined ? { reply_markup: markup } : {}) };
  let r = await api('editMessageText', body);
  if (!r.ok && /parse|entit|tag/i.test(r.description || '')) r = await api('editMessageText', { ...body, text: stripTags(body.text), parse_mode: undefined });
  if (r?.ok) await logOut(text, { edited: true });
  return r;
}
export const editButtons = (chat_id, message_id, markup) => api('editMessageReplyMarkup', { chat_id, message_id, reply_markup: markup || { inline_keyboard: [] } });
export const answer = (callback_query_id, text = '') => api('answerCallbackQuery', { callback_query_id, text });
export const react = (chat_id, message_id, emoji = '👍') => api('setMessageReaction', { chat_id, message_id, reaction: [{ type: 'emoji', emoji }] });
export const pin = (chat_id, message_id) => api('pinChatMessage', { chat_id, message_id, disable_notification: true });
export const unpin = (chat_id, message_id) => api('unpinChatMessage', { chat_id, message_id });
export const typing = chat_id => api('sendChatAction', { chat_id, action: 'typing' });
export const setWebhook = (url, secret) => api('setWebhook', { url, secret_token: secret, allowed_updates: ['message', 'edited_message', 'callback_query'] });
export const setCommands = commands => api('setMyCommands', { commands });

export async function sendVoice(chat_id, buf, caption = '', opts = {}) {
  const fd = new FormData();
  fd.append('chat_id', String(chat_id));
  const fmt = opts.format || 'ogg', mime = { mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav' }[fmt] || 'audio/ogg';
  fd.append('voice', new Blob([buf], { type: mime }), `brief.${fmt}`);
  if (caption) { fd.append('caption', toTelegramHTML(caption).slice(0, 1000)); fd.append('parse_mode', 'HTML'); }
  if (opts.silent) fd.append('disable_notification', 'true');
  return fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendVoice`, { method: 'POST', body: fd }).then(r => r.json());
}

export async function fileBuffer(file_id) {
  const f = await api('getFile', { file_id });
  const buf = await fetch(`https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${f.result.file_path}`).then(r => r.arrayBuffer());
  return Buffer.from(buf);
}
export async function photoBase64(photos) {
  return (await fileBuffer(photos[photos.length - 1].file_id)).toString('base64');
}
export const webhookInfo = () => api('getWebhookInfo', {});

export async function sendDocument(chat_id, buf, filename, caption = '', opts = {}) {
  const fd = new FormData();
  fd.append('chat_id', String(chat_id));
  fd.append('document', new Blob([buf], { type: 'application/pdf' }), filename);
  if (caption) { fd.append('caption', toTelegramHTML(caption).slice(0, 1000)); fd.append('parse_mode', 'HTML'); }
  if (opts.silent) fd.append('disable_notification', 'true');
  return fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendDocument`, { method: 'POST', body: fd }).then(r => r.json());
}
