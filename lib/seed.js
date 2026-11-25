// Historical tape measurements from Apple Notes (inches, kg).
// Chest on 2026-11-01 (33.5) looks like a typo and is left out.
// Thigh site changed in Apr 2026 (thickest point below glute), so thighs before/after are not comparable.
export const SEED_MEASUREMENTS = [
  { date: '2024-11-01', weight: 73.4, waist: 28.8, chest: 43.5, shoulders: 49.5, arms: 14.5, thighs: 17.5 },
  { date: '2025-02-03', weight: 77.0, waist: 29.2, chest: 43.7, shoulders: 50, arms: 14.2, thighs: 17.6 },
  { date: '2025-03-02', weight: 76.7, waist: 29.0, chest: 43, shoulders: 51, arms: 14.5, thighs: 17 },
  { date: '2025-03-29', weight: 75.5, waist: 28.7, chest: 42, shoulders: 51.5, arms: 14.5, thighs: 17.5 },
  { date: '2025-05-01', weight: 75.0, waist: 28.7, chest: 43, shoulders: 51.2, arms: 14.1, thighs: 17 },
  { date: '2025-06-02', weight: 76.6, waist: 28.8, chest: 42, shoulders: 50, arms: 14.7, thighs: 17.2 },
  { date: '2025-07-01', weight: 74.5, waist: 28.74, chest: 42.9, shoulders: 50.39, arms: 14.7, thighs: 18.1 },
  { date: '2025-08-01', weight: 72.8, waist: 27.9, chest: 41.3, shoulders: 48.8, arms: 14.3, thighs: 17.7 },
  { date: '2025-09-02', weight: 71.0, waist: 27.7, chest: 41.7, shoulders: 50, arms: 14.5, thighs: 16.9 },
  { date: '2025-10-01', weight: 71.5, waist: 27.9, chest: 41.3, shoulders: 48, arms: 14.3, thighs: 17.5 },
  { date: '2025-11-01', weight: 70.6, waist: 27.8, chest: 41.5, shoulders: 48, arms: 14.3, thighs: 17.5 },
  { date: '2025-12-08', weight: 73.5, waist: 28, chest: 42.5, shoulders: 50, arms: 14.5, thighs: 16.7 },
  { date: '2025-12-30', weight: null, waist: 27.5, chest: 43.5, shoulders: 50, arms: 14.5, thighs: 16.7, forearms: 11 },
  { date: '2026-01-30', weight: 73.7, waist: 27.5, chest: 43.25, shoulders: 49.5, arms: 14.5, thighs: 16.75, forearms: 11 },
  { date: '2026-02-24', weight: 75.0, waist: 29.5, chest: 43.2, shoulders: 50.5, arms: 14.6, thighs: 17.2, forearms: 11.2 },
  { date: '2026-03-31', weight: 74.9, waist: 28.3, chest: 42.3, shoulders: 50.5, arms: 14.2, thighs: 17.5, forearms: 11.3 },
  { date: '2026-04-30', weight: 76.4, waist: 28.5, chest: 43, shoulders: 51.3, arms: 14.8, thighs: 22.8, forearms: 11, glutes: 37.5 },
  { date: '2026-06-01', weight: 74.5, waist: 27.8, chest: 42.5, shoulders: 51, arms: 14.7, thighs: 22.5, forearms: 11.4, glutes: 36.5, neck: 14.5 },
  { date: '2026-08-10', weight: 76.7, waist: 28.8, chest: 42.5, shoulders: 50.8, arms: 14.8, thighs: 21.8, forearms: 11.2, glutes: 37, neck: 15.8 },
  { date: '2026-09-01', weight: 77.2, waist: 28.5, chest: 43, shoulders: 51, arms: 14.7, thighs: 21.5, forearms: 11.7, glutes: 37 },
  { date: '2026-10-05', weight: 77.7, waist: 28.5, chest: 42.5, shoulders: 51.5, arms: 14.8, thighs: 21.8, forearms: 11.2, glutes: 37.5, neck: 15.5 },
  { date: '2026-11-01', weight: 78.5, waist: 29.2, chest: null, shoulders: 51, arms: 15, thighs: 21.8, forearms: 11.8, glutes: 36.8, neck: 15.2 }
].map(m => ({ ...m, source: 'notes' }));
