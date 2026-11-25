// Parser regression set: every phrase that was once misread, run against the deployed parser
// (`/api/admin?parse=`, read-only). Usage: DASHBOARD_KEY=… node tests/parser-check.mjs [base-url]
import fs from 'fs';
const base = process.argv[2] || 'https://odey-body-tracker.vercel.app', key = process.env.DASHBOARD_KEY;
const cases = JSON.parse(fs.readFileSync(new URL('./parser-cases.json', import.meta.url)));
const cairo = d => new Date(d.getTime() + 2 * 3600e3).toISOString().slice(0, 10);
const vars = { $today: cairo(new Date()), $yesterday: cairo(new Date(Date.now() - 864e5)) };
const ok = (e, exp) => Object.entries(exp).every(([k, v]) => k.endsWith('~')
  ? new RegExp(v, 'i').test(JSON.stringify(e[k.slice(0, -1)] ?? ''))
  : (vars[v] ?? v) === (e[k] ?? (typeof v === 'boolean' ? false : null)));
let fails = 0;
await Promise.all(cases.map(async c => {
  const r = await fetch(`${base}/api/admin?parse=${encodeURIComponent(c.text)}`, { headers: { 'x-dashboard-key': key } }).then(r => r.json()).catch(e => ({ error: String(e) }));
  const got = Array.isArray(r) ? r : [];
  const pass = c.expect.every(exp => got.some(e => ok(e, exp)));
  if (!pass) fails++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${c.text}${pass ? '' : `\n      got: ${JSON.stringify(r).slice(0, 300)}`}`);
}));
console.log(`\n${cases.length - fails}/${cases.length} passed`);
process.exit(fails ? 1 : 0);
