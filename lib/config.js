// Targets and phases. Edit these and redeploy to change them.
export const CONFIG = {
  tz: 'Africa/Cairo',
  model: 'claude-sonnet-5-5',
  reviewModel: 'claude-opus-5-5', // once-a-night review: the deepest reasoning, worth the bigger model
  // Daily calories. Maintenance is an estimate; refine it after 2-3 weeks of logging
  // by comparing average intake with the weight trend.
  maintenanceKcal: 2700,
  cutKcal: 2200,
  proteinG: 190,
  stepsTarget: 15000,
  // Programme v2. Calorie cycling: low days unless today's gym session is B or D (or a planned feast), at most
  // `highPerWeek` high days (one more when a stop sign fires), tracked against `week`. Flat phases use `kcal`.
  phases: [
    { name: 'Calorie cycling', from: '2026-11-17', to: '2026-12-20', kcal: 1930, protein: 190, rate: -0.65,
      cycling: { low: 1500, high: 2700, highPerWeek: 2, week: 13500, feastCap: 3200 },
      fat: { low: 50, high: 80 }, carbs: { low: '50–75 g, around training', high: 'the rest' },
      note: '5 low days (1,500), 2 high (2,700) on B/D days or a planned feast' },
    { name: 'Ski trip break', from: '2026-12-21', to: '2027-01-03', kcal: 2700, protein: 170, rate: 0, fat: { min: 80 }, note: 'Maintenance; enjoy the trip' },
    { name: 'January check', from: '2027-01-04', to: '2027-03-07', kcal: 2200, kcalIfOnTarget: 2700, protein: 180, rate: -0.6, fat: { min: 70 },
      note: '~2,200 for 2–3 weeks only if the waist is above 27.5"; otherwise maintenance' }
  ],
  // rate = target weight change in kg/week for the phase (drives the weekly diet review).
  kcalFloor: 1400,
  alcoholUnitsPerWeek: 6,
  floors: { arms: 14.6, shoulders: 51 },
  targets: { weight: 73.5, waist: 27.5, ratio: 1.85 }
};

export const today = (d = new Date()) => d.toLocaleDateString('en-CA', { timeZone: CONFIG.tz });

export const currentPhase = (date = today()) =>
  CONFIG.phases.find(p => date >= p.from && date <= p.to) || { name: 'Maintain', kcal: CONFIG.maintenanceKcal, protein: 170, rate: 0, note: '' };
