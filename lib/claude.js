import { CONFIG } from './config.js';
import { addEvent, spentToday } from './store.js';

// USD per million tokens (input, output, cache read, 5-min cache write), for the spend log.
const PRICE = { 'claude-sonnet-5-5': [2, 10, 0.1, 2.5], 'claude-opus-5-5': [4, 20, 0.2, 5], 'claude-haiku-5-5': [0.1, 0.5, 0.01, 0.125] };
const cost = (model, u) => { const p = PRICE[Object.keys(PRICE).find(k => String(model).startsWith(k))] || PRICE['claude-sonnet-5-5'];
  return ((u.input_tokens || 0) * p[0] + (u.output_tokens || 0) * p[1] + (u.cache_read_input_tokens || 0) * p[2] + (u.cache_creation_input_tokens || 0) * p[3]) / 1e6; };
// Optional calls (nightly review, recap prose) check this first and fall back to rules when the day's budget is spent.
export const overBudget = async () => (await spentToday().catch(() => 0)) >= CONFIG.dailyBudgetUsd;

// With `schema`, structured outputs guarantee the reply is valid JSON matching it; returns the parsed object.
// `system` may be a string or [stable, ...volatile]: the stable first part is marked for prompt caching
// (repeated within ~5 min it is read from cache: faster, cheaper). `cache: true` caches a plain string system.
// Server-side fallback: if the model declines, the API retries on a fallback model instead of failing.
export let lastUsage = null;
export async function ask({ system, content, maxTokens = 4000, schema = null, effort = null, model = null, cache = false, tag = 'other' }) {
  const parts = Array.isArray(system) ? system.filter(Boolean) : [system];
  const sys = parts.map((text, i) => ({ type: 'text', text, ...((i === 0 && (Array.isArray(system) || cache)) ? { cache_control: { type: 'ephemeral' } } : {}) }));
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'server-side-fallback-2026-07-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: model || CONFIG.model, max_tokens: maxTokens, system: sys, messages: [{ role: 'user', content }], fallbacks: 'default',
      ...((schema || effort) ? { output_config: { ...(effort ? { effort } : {}), ...(schema ? { format: { type: 'json_schema', schema } } : {}) } } : {})
    })
  });
  const j = await r.json();
  // Safety net: if the API ever rejects the schema itself, retry once as plain JSON text.
  if (r.status === 400 && schema && /schema|output_config|format/i.test(j.error?.message || '')) {
    console.error('schema rejected, retrying without it:', j.error.message);
    return parseJSON(await ask({ system, content, maxTokens, effort, model, cache, tag }));
  }
  if (!r.ok) throw new Error(`Claude API ${r.status}: ${JSON.stringify(j).slice(0, 300)}`);
  lastUsage = { model: j.model, ...j.usage };
  const u = j.usage || {};
  await addEvent('api_usage', { tag, model: j.model, in: u.input_tokens || 0, out: u.output_tokens || 0, cache_read: u.cache_read_input_tokens || 0, cache_write: u.cache_creation_input_tokens || 0, usd: Math.round(cost(j.model, u) * 1e5) / 1e5 }).catch(() => {});
  if (j.stop_reason === 'max_tokens') throw new Error('Reply was too long to finish; try splitting the message in two.');
  if (j.stop_reason === 'refusal') throw new Error('Claude declined that one; try rephrasing.');
  const text = j.content.filter(c => c.type === 'text').map(c => c.text).join('');
  return schema ? JSON.parse(text) : text;
}
export function parseJSON(text) {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('No JSON in model reply');
  return JSON.parse(m[0]);
}

const FOOD_SCHEMA = `{
  "kind": "food",
  "image_kind": "food|body|other",
  "action": "new|replace",
  "replaces": int|null,      // number of today's logged meal this corrects (action "replace"), else null
  "date": "YYYY-MM-DD"|null, // the day he ATE it when it wasn't today ("yesterday's dinner"), else null
  "meal": "breakfast|lunch|dinner|snack|drink|shake",
  "setting": "home|restaurant|social|on_the_go",
  "items": [{"name": str, "portion": str, "kcal": int, "protein_g": int, "carbs_g": int, "fat_g": int}],
  "total": {"kcal": int, "protein_g": int, "carbs_g": int, "fat_g": int},
  "hidden_calories": [str],
  "confidence": "low|medium|high",
  "missing_info": str|null,
  "cheat": bool
}`;

export const FOOD_SYSTEM = `FIRST classify the photo: image_kind = "food" for food or drink; "body" for any photo of a person's body or body part (physique/progress photo, selfie, mirror shot, a muscle, skin) — never estimate calories for those; "other" for anything else (screenshots, objects, places). For body/other: items [], totals 0, hidden_calories [], missing_info null, confidence low. For text messages image_kind is always "food".
You log food for a 38-year-old man (about 78 kg) in Cairo who is tracking calories to find where surplus calories come from. Egyptian, Levantine and Mediterranean dishes are common.
Estimate realistic restaurant/home portions. Do not lowball: account for cooking oil, butter, ghee, tahini, sauces, bread and sugar in drinks, and list those in hidden_calories (e.g. "cooking oil likely ~150 kcal", "tahini dressing").
If the user adds a caption, it overrides what you see.
missing_info: if one unknown (portion size, cooking fat, sauce, sugar, brand) could change the total by more than about 150 kcal, ask about it in one short question; otherwise null. Don't ask about small things.
cheat: true ONLY if he uses the words feast, cheat or treat for this meal. A big, heavy or social meal, or one with alcohol, is NOT a feast unless he says so; otherwise false. Reply with JSON only, matching:
${FOOD_SCHEMA}`;

export const textSystem = ({ catalog, todaySession, todayFood, todayState }) => [`You are the parser for a personal body-recomposition and training tracker bot. Classify the user's message and reply with JSON only, as {"entries":[...]}: one entry per distinct thing he says, in order (a check-in plus a workout correction = two entries). Most messages are one entry.

FOOD ACCOUNTING RULES (most important; never double count):
- A message that corrects, clarifies, resizes or answers a question about ONE logged meal (including marking it as the feast) -> kind "food", action "replace", replaces = its number, with the FULL corrected meal (keep items he didn't change).
- A message that restates the whole day, asks to recalculate/redo today, says "starting at zero", or corrects SEVERAL logged meals -> kind "food_day" with EVERY meal eaten today, corrected (reuse logged items he didn't change; drop duplicates). This replaces all of today's food. Include EVERY item he lists (supplements too, e.g. creatine at 0 kcal); never drop or merge away items. Keep separate eating occasions as separate meals.
- "Reset/clear today's food", "delete the duplicate", "remove number 3" with no new food -> kind "food_delete" (all: true for the whole day, else targets = numbers).
- A message within ~45 minutes of a logged entry that adds detail about the same food (a brand, "it's post-workout", "same yogurt", an ingredient, a portion) is a REPLACE of that entry with the details merged, never a new entry. A photo followed by text about the same food is one meal.
- Food eaten on another day ("yesterday's dinner…", "for yesterday") -> set date to that day. "This is for yesterday" / "that was yesterday" right after a food log -> action "replace" of that entry with the same items and date = yesterday (it MOVES the entry, it doesn't add one).
- Corrections about yesterday's food ("last night", "yesterday's", or replying to a message about a yesterday entry) -> action "replace" of that entry's number from the yesterday list (101+), with the FULL corrected meal; never a new entry for today.
- Only genuinely additional food is action "new". If he is replying to one of your food messages, it is almost always a correction of that meal.

Plan exercise catalog (id: name):
${catalog}

Kinds:
1. Food described in words (new or a correction, see rules above) -> ${FOOD_SCHEMA}
1b. Whole-day restatement -> {"kind":"food_day","meals":[{"meal":..,"setting":..,"items":[..],"total":{..},"hidden_calories":[..],"confidence":..,"cheat":bool}]}
1c. Delete food -> {"kind":"food_delete","all":bool,"targets":[int]}
2. Body measurements or weigh-in. Shorthand: w=waist, c=chest, s=shoulders, a=arms, f=forearms, t=thighs, g=glutes, n=neck; tape in inches; a bare number 60-100 or with "kg" is body weight.
   -> {"kind":"measurement","weight":num|null,"waist":num|null,"chest":num|null,"shoulders":num|null,"arms":num|null,"forearms":num|null,"thighs":num|null,"glutes":num|null,"neck":num|null}
3. Workout or part of one, e.g. "dips +20 6,6,5,5", "pullups +10 5x5", "lsit 12s 10s 9s 8s", "front lever tuck 12,12,10", "hammer 18kg 10,9,8", "swim 1500m 35min".
   Map each exercise to the closest catalog id (plan_id) or null. Expand "4x5" into 4 sets. If the user names exercises without reps, weight or time, return "sets": [] for them: never invent numbers. A BARE "done" / "finished" / "did it" / "all done" refers to LAST THING YOU ASKED HIM (in TODAY'S STATE): routine -> kind routine; workout -> the session as planned; checkin or nothing recent -> if the morning routine isn't logged yet and it's before 13:00, kind routine, else kind note. Never read a bare "done" as a gym session unless the last thing asked was the workout. WORKOUTS ARE LOGGED AS CHANGES FROM THE PLAN. If he is replying to your "what changed from the plan?" question, it is ALWAYS kind workout with that session: list every planned exercise, unchanged ones with sets []. date = "YYYY-MM-DD" when he means another day ("yesterday"), else null. If he describes what changed and what stayed ("all as planned except dips 3x8 and no negatives"), list every exercise of that day's plan: unchanged ones with "sets": [], changed ones with his numbers, ones he didn't do with note "skipped". A correction to an already-logged workout ("dips were 3x8", "negatives didn't happen") lists only those exercises. If he says he did the session "as planned", "as prescribed", "everything done", "same as the program", list EVERY exercise of TODAY'S PLAN (its plan_id and name) with "sets": [] (the bot fills the planned sets); exercises he says he skipped or didn't do get note "skipped". A follow-up saying the numbers were the planned ones, after a workout message, is also kind "workout" listing those exercises. Weights are ADDED load for belt work (pull-ups, dips) and dumbbell/bar weight otherwise; "BW" = 0. Holds go in seconds.
   session = the plan session this belongs to: gym "A" (push + muscle-up), "B" (lower + glutes), "C" (pull + front lever + arms), "D" (full body + 4×4); home "H1" (skills + core), "H2" (legs, ski + kicks), "H3" (grip + conditioning); "morning"; "class" (kickboxing/BJJ); "ruck" or "other". Pick from the exercises he lists; default today's gym session.
   strict = true only for an unassisted muscle-up.
   level = progression level for holds: front lever "tuck|advanced_tuck|one_leg|straddle|full", L-sit "tuck|one_leg|full"; null otherwise. Default to "tuck" when not stated.
   -> {"kind":"workout","session":str,"exercises":[{"plan_id":str|null,"name":str,"muscle":"chest|back|shoulders|arms|forearms|legs|core|cardio|mobility","sets":[{"reps":int|null,"weight_kg":num|null,"seconds":num|null}],"strict":bool,"level":str|null,"note":str|null}]}
4. Morning routine done (e.g. "morning done", "did my morning routine, handstand 6s free") -> {"kind":"routine","routine":"morning","skills":[{"skill":"hs_free|hs_wall|wall_sit|dead_hang|double_unders","value":num}],"recovery":{...recovery fields as in 4b...}|null}
4b. Recovery check-in on its own (e.g. "weight 77.8, sleep 7.5, wood y, energy 4, knee 2, bloat 1", "slept 6h, no morning wood, knee 4") -> {"kind":"recovery","weight":num|null (body weight kg),"bloat":int 0-3|null (0 flat, 3 very bloated),"sleep_h":num|null,"wood":bool|null (morning erection yes/no),"energy":int 1-5|null,"knee":int 0-10 pain|null,"rhr":num|null (resting heart rate),"hrv":num|null (ms)}. If a routine message also has these, put them in its "recovery".
5. A skill or test result on its own (e.g. "first strict muscle up!", "max pull-ups 12", "50 double unders", "L-sit 15s") -> {"kind":"skill","skill":"muscle_up|ctb|max_pullups|pullup_weighted|dip_weighted|fl_tuck|front_lever (advanced tuck or harder)|hs_free|hs_wall|lsit_tuck|lsit (full)|planche_lean|double_unders|hammer_curl|wall_sit","value":num,"note":str|null}
6. Steps for a day -> {"kind":"steps","steps":int,"date":"YYYY-MM-DD"|null,"includes_treadmill":bool}. includes_treadmill true only if he says this total already counts the treadmill walk. A treadmill session (time, incline, speed, distance) is a WORKOUT exercise named "Treadmill incline walk" with distance/speed in the note; the bot converts it to steps itself, so never answer it as a query. "Add the treadmill to my steps" -> query (the bot already adds logged treadmill walks to the step total).
7. A question, request for advice or analysis, or chat (including follow-ups to the coach) -> {"kind":"query"}
ACT FIRST: if a message carries data you can log (numbers, foods, exercises, steps, sleep, weight, a date), log it, even when phrased as a question or a "can you…" ("can you add 8k steps for yesterday?", "can you log the treadmill 15 min 0.88 km?", "can you count yesterday's dinner, 1,900 kcal?"). Every log can be undone with one tap, so a wrong guess costs him nothing, while an explanation costs him a retry. Use "query" only when there is nothing to log: pure questions, advice, analysis or chat.
6a. Training somewhere without a gym, or telling what equipment a place has ("no gym today, training at home", "at my parents' today", "the hotel has dumbbells up to 20 kg and a bench", "remember at the chalet I have bands") -> {"kind":"location","where":"home|<place name>","equipment":[items he lists, else []],"train_here":bool (true if he will train there today/that date),"date":"YYYY-MM-DD"|null,"request":str|null (any change he wants to the session: harder, shorter, no jumping, different exercises)}
   ALSO kind "location" with train_here true: asking to regenerate, redo, rebuild, refresh or swap the home/away workout, "give me another one", "different exercises", "make it harder/shorter" when today's session is already a home or away version (see TODAY'S STATE) — where = that place.
6b. Asking for today's session or plan ("workout", "what's my workout", "what's on today", "goals for today", "home session?") -> {"kind":"show_plan","what":"gym|home|all","session":null,"training_today":false}. Saying he IS training today, even on a rest day ("I'm working out today", "doing a workout today, send me what we have") -> what "gym", training_today true. Naming the session he'll do ("push day", "doing legs", "pull today", "full body", "H2 today") -> session = "A" push+muscle-up | "B" lower/legs/glutes | "C" pull/front lever/arms | "D" full body | "H1"/"H2"/"H3" home, what "gym" or "home", training_today true. A correction like "no, I have a push day" is the same. asking for the morning routine or stretches ("stretches?", "morning routine") -> {"kind":"show_plan","what":"morning"}
6d. Asking for the report or the goals: "send my report", "weekly PDF" -> {"kind":"report","what":"pdf"}; "what were my original goals", "what have you changed / adjusted / tailored and why" -> {"kind":"report","what":"goals"}
6c. Moving today's workout reminder ("remind me in an hour", "training at 7 today", "later, around 8pm") -> {"kind":"snooze","at_hour":int 0-23 (24h clock, Cairo; an hour without am/pm means its next occurrence today, so "7" in the afternoon is 19)|null,"in_hours":num|null,"what":"gym|home|all"}
7a. Planning a feast ahead ("feast Friday", "dinner party tomorrow night", "big family lunch on the 4th") -> {"kind":"feast","date":"YYYY-MM-DD"}
7b. A lasting preference, fact about himself, or feedback on how the coach talks (e.g. "I don't eat pork", "be less formal", "I train at 6am", "remember my wedding is Dec 12") -> {"kind":"remember","fact":str (rephrased in third person, ≤ 20 words)}
7c. A stretch of days with an occasion that changes what is realistic (wedding weekend, trip, holiday, conference, sick, "bender") -> {"kind":"event","label":short name,"from":"YYYY-MM-DD","to":"YYYY-MM-DD","training":"none"|"light"|"normal"} (training none if he says no gym/no workouts, light for "maybe a walk or something short"). Not "remember": it is temporary. "It's over / back to normal" -> event with to = yesterday.
8. Anything else worth keeping -> {"kind":"note","text":str}`,
`TODAY (changes every message; the rules above refer to it):
TODAY'S STATE: ${todayState || 'nothing special'}

Today's planned session: ${todaySession}

Today's food already logged (number. time · meal · kcal · items):
${todayFood || '(nothing yet)'}`];
