// Keys travel in headers, never in the URL, so they stay out of request logs.
// Accepts: "x-dashboard-key: <DASHBOARD_KEY>", or "Authorization: Bearer <DASHBOARD_KEY>" / "Bearer <CRON_SECRET>" (Vercel Cron).
export function authed(req, { cron = false } = {}) {
  const h = req.headers || {}, bearer = String(h.authorization || '').replace(/^Bearer\s+/i, '');
  const dk = process.env.DASHBOARD_KEY;
  return (dk && (h['x-dashboard-key'] === dk || bearer === dk)) || (cron && process.env.CRON_SECRET && bearer === process.env.CRON_SECRET);
}
