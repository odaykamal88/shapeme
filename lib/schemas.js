// JSON schemas for structured outputs (output_config.format): the API guarantees replies match these.
// Strict mode rules: every object lists all properties in `required` and sets additionalProperties: false.
const obj = props => ({ type: 'object', additionalProperties: false, required: Object.keys(props), properties: props });
const orNull = t => ({ anyOf: [{ type: t }, { type: 'null' }] });
const str = { type: 'string' }, int = { type: 'integer' }, num = { type: 'number' };

const macros = { kcal: int, protein_g: int, carbs_g: int, fat_g: int };
const MEAL = {
  meal: { type: 'string', enum: ['breakfast', 'lunch', 'dinner', 'snack', 'drink', 'shake'] },
  setting: { type: 'string', enum: ['home', 'restaurant', 'social', 'on_the_go'] },
  items: { type: 'array', items: obj({ name: str, portion: str, ...macros }) },
  total: obj(macros),
  hidden_calories: { type: 'array', items: str },
  confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
  cheat: { type: 'boolean' }
};
export const FOOD = obj({
  kind: { type: 'string', enum: ['food'] },
  image_kind: { type: 'string', enum: ['food', 'body', 'other'] },
  action: { type: 'string', enum: ['new', 'replace'] },
  replaces: orNull('integer'),
  date: orNull('string'),
  meal: { type: 'string', enum: ['breakfast', 'lunch', 'dinner', 'snack', 'drink', 'shake'] },
  setting: { type: 'string', enum: ['home', 'restaurant', 'social', 'on_the_go'] },
  items: { type: 'array', items: obj({ name: str, portion: str, ...macros }) },
  total: obj(macros),
  hidden_calories: { type: 'array', items: str },
  confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
  missing_info: orNull('string'),
  cheat: { type: 'boolean' }
});

const kind = k => ({ type: 'string', enum: [k] });
const MEASUREMENT = obj({ kind: kind('measurement'), ...Object.fromEntries(['weight', 'waist', 'chest', 'shoulders', 'arms', 'forearms', 'thighs', 'glutes', 'neck'].map(k => [k, orNull('number')])) });
const WORKOUT = obj({
  kind: kind('workout'),
  session: str,
  date: orNull('string'),
  exercises: { type: 'array', items: obj({
    plan_id: orNull('string'), name: str,
    muscle: { type: 'string', enum: ['chest', 'back', 'shoulders', 'arms', 'forearms', 'legs', 'core', 'cardio', 'mobility'] },
    sets: { type: 'array', items: obj({ reps: orNull('integer'), weight_kg: orNull('number'), seconds: orNull('number') }) },
    strict: { type: 'boolean' }, level: orNull('string'), note: orNull('string')
  }) }
});
const REC = { weight: orNull('number'), bloat: orNull('integer'), sleep_h: orNull('number'), wood: orNull('boolean'), energy: orNull('integer'), knee: orNull('integer'), rhr: orNull('number'), hrv: orNull('number') };
const RECOVERY = obj({ kind: kind('recovery'), ...REC });
const ROUTINE = obj({ kind: kind('routine'), routine: kind('morning'), skills: { type: 'array', items: obj({ skill: str, value: num }) }, recovery: { anyOf: [obj(REC), { type: 'null' }] } });
const SKILL = obj({ kind: kind('skill'), skill: str, value: num, note: orNull('string') });
const STEPS = obj({ kind: kind('steps'), steps: int, date: orNull('string'), includes_treadmill: { type: 'boolean' } });
const QUERY = obj({ kind: kind('query') });
const NOTE = obj({ kind: kind('note'), text: str });
const REMEMBER = obj({ kind: kind('remember'), fact: str });
const EVENT = obj({ kind: kind('event'), label: str, from: str, to: str, training: { type: 'string', enum: ['none', 'light', 'normal'] } });
const FEAST = obj({ kind: kind('feast'), date: str });
const LOCATION = obj({ kind: kind('location'), where: str, equipment: { type: 'array', items: str }, train_here: { type: 'boolean' }, date: orNull('string'), request: orNull('string') });
const REPORT = obj({ kind: kind('report'), what: { type: 'string', enum: ['pdf', 'goals'] } });
const SNOOZE = obj({ kind: kind('snooze'), at_hour: orNull('integer'), in_hours: orNull('number'), what: { type: 'string', enum: ['gym', 'home', 'all'] } });
const SHOW_PLAN = obj({ kind: kind('show_plan'), what: { type: 'string', enum: ['gym', 'home', 'all', 'morning'] }, session: orNull('string'), training_today: { type: 'boolean' } });
const FOOD_DAY = obj({ kind: kind('food_day'), meals: { type: 'array', items: obj(MEAL) } });
const FOOD_DELETE = obj({ kind: kind('food_delete'), all: { type: 'boolean' }, targets: { type: 'array', items: int } });

// Root must be an object, so the parsed message sits under `entry`.
export const TEXT = obj({ entries: { type: 'array', items: { anyOf: [FOOD, FOOD_DAY, FOOD_DELETE, MEASUREMENT, WORKOUT, ROUTINE, RECOVERY, SKILL, STEPS, QUERY, FEAST, LOCATION, SNOOZE, REPORT, SHOW_PLAN, REMEMBER, EVENT, NOTE] } } });

export const ADAPT = obj({
  summary: str,
  days: { type: 'array', items: obj({
    date: str, changed: { type: 'boolean' }, name: str, reason: str,
    exercises: { type: 'array', items: obj({ plan_id: orNull('string'), name: str, target: str, cue: str }) }
  }) }
});

export const DIET = obj({ summary: str, recommendations: { type: 'array', items: str } });

export const PROFILE = obj({ notes: { type: 'array', items: str }, style: str });

export const HABITS = obj({
  summary: str,
  staples: { type: 'array', items: obj({ item: str, tip: str }) },
  occasional: { type: 'array', items: obj({ when: str, tip: str }) }
});

export const IMPROVE = obj({
  summary: str,
  focus: str,
  workout_days: { type: 'array', items: obj({
    date: str, reason: str,
    exercises: { type: 'array', items: obj({ plan_id: orNull('string'), name: str, target: str, cue: str }) }
  }) },
  routine: obj({ change: { type: 'boolean' }, reason: str, items: { type: 'array', items: obj({ id: orNull('string'), name: str, target: str }) } }),
  diet: obj({ change: { type: 'boolean' }, reason: str, low_kcal: orNull('integer'), high_kcal: orNull('integer'), protein_g: orNull('integer') }),
  tomorrow_kcal: obj({ change: { type: 'boolean' }, kcal: orNull('integer'), reason: str }),
  rationale: { type: 'array', items: obj({ area: { type: 'string', enum: ['workout', 'stretches', 'diet'] }, change: str, why: str }) }
});
