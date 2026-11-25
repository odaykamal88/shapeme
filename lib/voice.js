// Voice notes → text with Whisper on Groq (Claude does not take audio). Needs GROQ_API_KEY.
import { fileBuffer } from './tg.js';
import { Mp3Encoder } from '@breezystack/lamejs';

export async function transcribe(fileId) {
  const buf = await fileBuffer(fileId);
  const fd = new FormData();
  fd.append('file', new Blob([buf], { type: 'audio/ogg' }), 'voice.ogg');
  fd.append('model', 'whisper-large-v3-turbo');
  fd.append('prompt', 'Workout and food log: sets, reps, kg, BW, dips, pull-ups, L-sit, front lever, handstand, ful, eish baladi, tahini, koshari, fatteh.');
  const r = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST', headers: { authorization: `Bearer ${process.env.GROQ_API_KEY}` }, body: fd
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`Transcription ${r.status}: ${JSON.stringify(j).slice(0, 200)}`);
  return (j.text || '').trim();
}

// Text → speech with Groq's Orpheus voice, for the optional morning audio. Returns null if unavailable
// (e.g. the model's terms haven't been accepted in the Groq console yet), so callers just skip it.
export async function speak(text, { voice = process.env.MORNING_VOICE_NAME || 'troy' } = {}) {
  if (!process.env.GROQ_API_KEY || process.env.MORNING_VOICE === 'off') return null;
  const input = String(text).replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim().slice(0, 1000);
  for (const format of ['wav']) { // the model only returns WAV; converted to MP3 below
    const r = await fetch('https://api.groq.com/openai/v1/audio/speech', {
      method: 'POST', headers: { authorization: `Bearer ${process.env.GROQ_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'canopylabs/orpheus-v1-english', voice, input, response_format: format })
    }).catch(() => null);
    if (r?.ok) {
      const buf = Buffer.from(await r.arrayBuffer());
      if (format === 'wav') { try { return { buf: wavToMp3(buf), format: 'mp3' }; } catch (e) { console.error('wav→mp3', e); return { buf, format }; } }
      return { buf, format };
    }
    const err = r ? await r.text().catch(() => '') : 'network';
    if (/terms|not found|access/i.test(err)) { console.error('speak:', err.slice(0, 200)); return null; }
  }
  return null;
}

// Groq's speech model returns WAV only; Telegram voice notes take MP3, so convert (pure JS, mono).
export function wavToMp3(wav, kbps = 64) {
  const dv = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  let off = 12, fmt = null, data = null;
  while (off + 8 <= wav.length) {
    const id = wav.toString('ascii', off, off + 4), size = dv.getUint32(off + 4, true);
    if (id === 'fmt ') fmt = { format: dv.getUint16(off + 8, true), channels: dv.getUint16(off + 10, true), rate: dv.getUint32(off + 12, true), bits: dv.getUint16(off + 22, true) };
    if (id === 'data') { data = { start: off + 8, size: Math.min(size, wav.length - off - 8) }; break; }
    off += 8 + size + (size % 2);
  }
  if (!fmt || !data) throw new Error('not a WAV file');
  const n = Math.floor(data.size / (fmt.bits / 8) / fmt.channels), mono = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let c = 0; c < fmt.channels; c++) {
      const p = data.start + (i * fmt.channels + c) * (fmt.bits / 8);
      sum += fmt.bits === 16 ? dv.getInt16(p, true) : fmt.bits === 32 && fmt.format === 3 ? Math.max(-1, Math.min(1, dv.getFloat32(p, true))) * 32767 : fmt.bits === 32 ? dv.getInt32(p, true) / 65536 : (dv.getUint8(p) - 128) * 256;
    }
    mono[i] = Math.round(sum / fmt.channels);
  }
  const enc = new Mp3Encoder(1, fmt.rate, kbps), out = [];
  for (let i = 0; i < mono.length; i += 1152) { const b = enc.encodeBuffer(mono.subarray(i, i + 1152)); if (b.length) out.push(Buffer.from(b)); }
  const end = enc.flush(); if (end.length) out.push(Buffer.from(end));
  return Buffer.concat(out);
}
