// Make any text safe for Telegram's HTML mode: convert markdown that Claude writes (**bold**, *italic*,
// `code`, # headings, - bullets) to HTML, keep the tags Telegram supports, escape everything else.
const ALLOWED = /^<\/?(b|strong|i|em|u|s|code|pre|a|blockquote|tg-spoiler)(\s[^>]*)?>$/i;
const escText = s => s.replace(/&(?!(#\d+|#x[\da-f]+|[a-z]+);)/gi, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function markdown(s) {
  return s
    .replace(/^#{1,6}\s+(.+)$/gm, '**$1**')                 // headings → bold line
    .replace(/^\s*[-*]\s+/gm, '• ')                          // bullets
    .replace(/\*\*([^*\n]+?)\*\*/g, '<b>$1</b>')
    .replace(/__([^_\n]+?)__/g, '<b>$1</b>')
    .replace(/(^|[\s(])\*([^*\n]+?)\*(?=[\s).,!?:;]|$)/gm, '$1<i>$2</i>')
    .replace(/(^|[\s(])_([^_\n]+?)_(?=[\s).,!?:;]|$)/gm, '$1<i>$2</i>')
    .replace(/`([^`\n]+?)`/g, '<code>$1</code>');
}

export function toTelegramHTML(text) {
  // Leave <pre>/<code> blocks untouched (copy-paste templates).
  return String(text).split(/(<pre>[\s\S]*?<\/pre>|<code>[\s\S]*?<\/code>)/g).map((part, i) => {
    if (i % 2) return part;
    return markdown(part).split(/(<[^<>]+>)/g).map((t, j) => (j % 2 && ALLOWED.test(t)) ? t : escText(t)).join('');
  }).join('').replace(/\n{3,}/g, '\n\n').trim();
}

export const stripTags = s => String(s).replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

// Telegram caps messages at 4096 chars: split on paragraph breaks.
export function chunks(s, max = 3900) {
  if (s.length <= max) return [s];
  const out = []; let cur = '';
  for (const para of s.split('\n\n')) {
    if ((cur + '\n\n' + para).length > max && cur) { out.push(cur); cur = para; } else cur = cur ? cur + '\n\n' + para : para;
  }
  if (cur) out.push(cur);
  return out;
}
