# Body tracker

Telegram bot + dashboard for the recomp and the training plan. Send it food photos, weigh-ins, tape, sets and skill results; it logs everything against the plan, shows a dashboard, sends today's session at 06:30 Cairo and a Sunday check-in at 07:00.

## Deploy (about 10 minutes, once)

1. **Create the bot.** In Telegram, message `@BotFather` → `/newbot` → pick a name → copy the token.
2. **Get an Anthropic API key** at console.anthropic.com (add ~$10 credit; food photos cost roughly 1–2 cents each).
3. On your Mac, unzip this folder, open Terminal in it, and run `bash setup.sh`. It links the Vercel project, asks you to create a Blob store in the dashboard, takes the two secrets, generates the rest, deploys, and registers the Telegram webhook.
4. Message your bot `/start`. That locks it to your account; anyone else is ignored.
5. **Steps (optional):** install *Health Auto Export* on your iPhone → Automations → REST API → metrics *Step Count, Sleep Analysis, Resting Heart Rate, Heart Rate Variability*, aggregation *Day*, format JSON, URL = the `STEPS_WEBHOOK` line in `.keys.local`, daily.

## Using it

| Send | What happens |
|---|---|
| A food photo (caption optional: "half portion", "cooked in olive oil") | Itemised calories/macros, hidden-calorie flags, running daily total |
| `fatteh with lamb, big plate, 2 pepsis` | Same, from text |
| `78.1` or `78.1 w29 s51 a15 c43` | Weigh-in / tape (w waist, c chest, s shoulders, a arms, f forearms, t thighs, g glutes, n neck) |
| `dips +20 6,6,5,5` · `pullups +10 5x5` · `hammer 18kg 10,9,8` | Sets logged against the plan, with last time's numbers, PRs and a "add 2.5 kg next time" nudge |
| `lsit 12s 10s 9s` · `front lever adv tuck 8s 7s` | Holds; levels feed their own ladders (tuck vs advanced, tuck vs full L-sit) |
| `morning done, handstand 6s free` | Morning routine + streak |
| `max pull-ups 12` · `first strict muscle up` · `50 double unders` | Skill/test results |
| `swim 1500m 35min` | Cardio log |
| `12400 steps` | Manual steps (if not using Health Auto Export) |
| `where are my extra calories coming from?` | Coaching answer from the last 14 days |
| `/plan` `/today` `/week` `/skills` `/undo` | Today's session · food + what's left to log · 7-day summary · skill ladders · delete last entry |

Every Sunday at 07:00 Cairo you get a check-in: on track or not, where the calories came from, one change.

## Changing the plan or targets

The training plan, block calendar and skill ladders live in `lib/plan.js`. Calorie phases and body targets live in `lib/config.js`.

## Changing targets (calories)

Edit `lib/config.js` (calories per phase, protein, steps, floors) and run `npx vercel deploy --prod`. The maintenance estimate (2,700 kcal) is a starting guess: after 2–3 weeks of honest logging, compare average intake with the weight trend and adjust.

Your Notes measurements since Nov 2024 are preloaded in `lib/seed.js`.
