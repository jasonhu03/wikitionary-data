// generator.js: builds a p-q-c phrase from grammatical templates, with a definition popup on click.
// The page structure lives in index.html; this file only sets text.
let words = null;          // { p: { noun: [[word, zipf], ...], ... }, q: {...}, c: {...} }
let defs = null;           // loaded the first time someone clicks a word
let defsLoading = null;
let current = [];          // base forms of the words on screen, for definition lookup

const LETTERS = ["p", "q", "c"];
const $ = (id) => document.getElementById(id);

// ---------- templates ----------
// Each slot: [part of speech, form]. Slot 1 is always p, slot 2 q, slot 3 c.
// Forms: "base" = as-is, "plural" = noun plural, "s" = verb with -s, "ing" = verb with -ing.
// quality: how good the template is on its own (3 = best, 1 = weakest, 0 = off).
// Tune these by clicking; the final weight also depends on pool sizes (see pickTemplate).
const TEMPLATES = [
  // best: a tiny scene, someone doing something to something
  { name: "nouns verb nouns",    quality: 3, slots: [["noun", "plural"], ["verb", "base"], ["noun", "plural"]] },   // pirates quaff cucumbers
  { name: "verb adj nouns",      quality: 3, slots: [["verb", "base"], ["adj", "base"], ["noun", "plural"]] },      // ponder quaint cucumbers
  { name: "name verbs nouns",    quality: 2, slots: [["name", "base"], ["verb", "s"], ["noun", "plural"]] },        // Pluto quaffs crumpets (3 once names are curated)
  // good
  { name: "adj nouns verb",      quality: 2, slots: [["adj", "base"], ["noun", "plural"], ["verb", "base"]] },      // plump quokkas cackle
  { name: "adv verb nouns",      quality: 2, slots: [["adv", "base"], ["verb", "base"], ["noun", "plural"]] },      // promptly quaff cider
  { name: "adj noun nouns",      quality: 2, slots: [["adj", "base"], ["noun", "base"], ["noun", "plural"]] },      // pompous quokka cufflinks
  { name: "intj, nouns verb",    quality: 2, slots: [["intj", "base"], ["noun", "plural"], ["verb", "base"]] },     // pshaw, quokkas cackle
  { name: "intj, adj nouns",     quality: 2, slots: [["intj", "base"], ["adj", "base"], ["noun", "plural"]] },      // phooey, queasy crumpets
  { name: "adj adj nouns",       quality: 2, slots: [["adj", "base"], ["adj", "base"], ["noun", "plural"]] },       // prickly quaint crumpets
  // weakest: muddy, bland, or ending on a deflating adverb
  { name: "noun noun nouns",     quality: 1, slots: [["noun", "base"], ["noun", "base"], ["noun", "plural"]] },     // pickle quarantine committees
  { name: "verb-ing noun nouns", quality: 1, slots: [["verb", "ing"], ["noun", "base"], ["noun", "plural"]] },      // prancing quokka circuses
  { name: "verb nouns adv",      quality: 1, slots: [["verb", "base"], ["noun", "plural"], ["adv", "base"]] },      // pickle quinces carefully
  { name: "nouns verb adv",      quality: 1, slots: [["noun", "plural"], ["verb", "base"], ["adv", "base"]] },      // porcupines quiver cautiously
  { name: "adv adj nouns",       quality: 1, slots: [["adv", "base"], ["adj", "base"], ["noun", "plural"]] },       // perfectly quaint cupcakes
];

// ---------- inflection (simple English rules; irregular words will occasionally look odd) ----------
function pluralize(w) {
  if (/\s/.test(w)) {
    // multi-word: pluralize the last word ("quantum limit" -> "quantum limits")
    const parts = w.split(" ");
    parts[parts.length - 1] = pluralize(parts[parts.length - 1]);
    return parts.join(" ");
  }
  if (/[^aeiou]y$/i.test(w)) return w.slice(0, -1) + "ies";
  if (/^[^aeiou]*[aeiou]z$/i.test(w.replace(/^qu/i, "q"))) return w + "zes";  // quiz -> quizzes
  if (/(s|x|z|ch|sh)$/i.test(w)) return w + "es";
  if (/[^aeiou]o$/i.test(w)) return w + "es";
  return w + "s";
}

function thirdPerson(v) {
  if (/\s/.test(v)) {                 // phrasal verb: inflect the first word ("pick up" -> "picks up")
    const [first, ...rest] = v.split(" ");
    return [thirdPerson(first), ...rest].join(" ");
  }
  if (/[^aeiou]y$/i.test(v)) return v.slice(0, -1) + "ies";
  if (/(s|x|z|ch|sh|o)$/i.test(v)) return v + "es";
  return v + "s";
}

function ing(v) {
  if (/\s/.test(v)) {
    const [first, ...rest] = v.split(" ");
    return [ing(first), ...rest].join(" ");
  }
  if (/ie$/i.test(v)) return v.slice(0, -2) + "ying";               // tie -> tying
  if (/[^aeiouy]e$/i.test(v) && !/ee$/i.test(v)) return v.slice(0, -1) + "ing";  // quake -> quaking
  // short consonant-vowel-consonant verbs double the last letter; "qu" counts as one consonant
  if (/^[^aeiou]*[aeiou][^aeiouwxy]$/i.test(v.replace(/^qu/i, "q"))) return v + v.slice(-1) + "ing"; // quip -> quipping
  return v + "ing";
}

function inflect(word, pos, form) {
  if (form === "plural" && pos === "noun" && !/^[A-Z]/.test(word)) return pluralize(word);
  if (form === "s") return thirdPerson(word);
  if (form === "ing") return ing(word);
  return word;
}

// ---------- commonness ----------
// Tuning knobs
const FAMILIAR_FLOOR = 2.5;  // words at or above this zipf count as familiar
const WILD_CHANCE = 0.35;    // chance a phrase gets one hand-picked wild word (wild.txt). Max one per phrase.

// Modes:
//   mix      familiar words, plus the occasional wild word (the real site)
//   familiar familiar words only
//   wild     put a wild word in every slot that has one (for testing wild.txt)
//   any      everything in words.json (debugging)
function bucketsFor(mode) {
  if (mode === "mix") {
    const wildSlot = Math.random() < WILD_CHANCE ? Math.floor(Math.random() * 3) : -1;
    return [0, 1, 2].map((i) => (i === wildSlot ? "wild" : "familiar"));
  }
  return [mode, mode, mode];
}

const FILTERS = {
  familiar: (e) => e[1] >= FAMILIAR_FLOOR && !e[3],
  wild: (e) => e[3] === 1,
  any: () => true,
};

// If a slot has no wild word for that letter and part of speech, it falls back to familiar.
const FALLBACK = {
  familiar: ["familiar"],
  wild: ["wild", "familiar"],
  any: ["any"],
};

// Words shown recently, per letter, so small pools don't repeat back to back.
const RECENT_SIZE = 15;
const recent = { p: [], q: [], c: [] };

function remember(letter, word) {
  const list = recent[letter];
  list.push(word.toLowerCase());
  if (list.length > RECENT_SIZE) list.shift();
}

// How much playful-sounding words are favored. Weight = 1 + whimsy * WHIMSY_BOOST.
// 0 = all words equally likely; 0.5 = a whimsy-6 word is 4x as likely as a plain one.
const WHIMSY_BOOST = 0.5;

function weightedPick(pool) {
  const weights = pool.map((e) => 1 + (e[4] || 0) * WHIMSY_BOOST);
  let r = Math.random() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i];
    if (r <= 0) return pool[i];
  }
  return pool[pool.length - 1];
}

// Returns the pool a slot draws from (after funny-only, bucket, and recent-word filtering).
function poolFor(list, bucket, letter) {
  if ($("funnyOnly").checked) {
    const funny = list.filter((e) => e[2]);
    if (funny.length) list = funny;
  }
  const seen = new Set(recent[letter]);
  for (const b of FALLBACK[bucket]) {
    const pool = list.filter(FILTERS[b]);
    if (!pool.length) continue;
    const fresh = pool.filter(([w]) => !seen.has(w.toLowerCase()));
    return fresh.length ? fresh : pool;   // tiny pools: allow a repeat rather than fail
  }
  return [];
}

// ---------- sound matching ----------
// Spelling-based guesses at how well words sound together (no pronunciation data needed).
const vowelGroups = (w) => w.toLowerCase().match(/[aeiouy]+/g) || [];

function harmony(word, others) {
  const w = word.toLowerCase();
  let s = 0;
  if (/^(ca|co|cu|cl|cr|ck)/.test(w)) s += 2;    // hard c: echoes the /k/ of the q word
  if (/^(ce|ci|cy)/.test(w)) s -= 1;             // soft c breaks the p-k-k pattern
  const myVowel = vowelGroups(w)[0];
  const mySyl = vowelGroups(w).length;
  for (const o of others) {
    const x = o.toLowerCase();
    if (w.slice(-3) === x.slice(-3)) s += 3;      // near rhyme: pocket / cricket
    else if (w.slice(-2) === x.slice(-2)) s += 2; // softer echo: piffle / quibble... -le
    if (myVowel && myVowel === vowelGroups(x)[0]) s += 1;   // assonance: puffin / custard
    if (mySyl === vowelGroups(x).length) s += 0.5;          // matching rhythm
  }
  return s;
}

// How many candidates the last word is chosen from. Higher = more sound matching, less randomness.
const HARMONY_CANDIDATES = 6;

function pickBestSounding(pool, others) {
  const tries = Array.from({ length: Math.min(HARMONY_CANDIDATES, pool.length) }, () => weightedPick(pool));
  let best = tries[0], bestScore = -Infinity;
  for (const e of tries) {
    const sc = harmony(e[0], others) + Math.random();   // small jitter breaks ties
    if (sc > bestScore) { best = e; bestScore = sc; }
  }
  return best;
}

// ---------- generation ----------
// Template weight = quality x (smallest pool among its three slots) ^ POOL_POWER.
// The smallest pool is what repeats first, so a template with only 20 q verbs shows up
// far less than one whose slots all have hundreds of words.
//   POOL_POWER = 1   proportional to the bottleneck pool (what you asked for)
//   POOL_POWER = 0.5 softened, so small pools still get a fair share
//   POOL_POWER = 0   ignore pool sizes, quality only
const POOL_POWER = 1;

function bottleneck(t) {
  return Math.min(...t.slots.map(([pos], i) => words[LETTERS[i]][pos].length));
}

function templateWeight(t) {
  return t.quality * Math.pow(bottleneck(t), POOL_POWER);
}

function pickTemplate(templates) {
  const weights = templates.map(templateWeight);
  let r = Math.random() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < templates.length; i++) {
    r -= weights[i];
    if (r <= 0) return templates[i];
  }
  return templates[templates.length - 1];
}

// Prints how often each template will appear, so you can sanity-check the weights.
function logTemplateShares() {
  const ts = usableTemplates();
  const total = ts.map(templateWeight).reduce((a, b) => a + b, 0);
  console.table(ts.map((t) => ({
    template: t.name,
    quality: t.quality,
    "smallest pool": bottleneck(t),
    "share %": +(100 * templateWeight(t) / total).toFixed(1),
  })));
}

function usableTemplates() {
  return TEMPLATES.filter((t) => t.quality > 0 &&
    t.slots.every(([pos], i) => words[LETTERS[i]][pos] && words[LETTERS[i]][pos].length > 0)
  );
}

function generate() {
  const mode = $("mode").value;
  const showZipf = $("showZipf").checked;
  const templates = usableTemplates();
  if (!templates.length) {
    $("word-p").textContent = "no template has words for every slot";
    return;
  }
  let t, picks;
  for (let attempt = 0; attempt < 20; attempt++) {
    t = pickTemplate(templates);
    const buckets = bucketsFor(mode);
    picks = [];
    t.slots.forEach(([pos, form], i) => {
      const pool = poolFor(words[LETTERS[i]][pos], buckets[i], LETTERS[i]);
      if (!pool.length) { picks.push(null); return; }
      const others = picks.filter(Boolean).map((p) => p.base);
      const e = i === 2 ? pickBestSounding(pool, others) : weightedPick(pool);
      picks.push({ base: e[0], zipf: e[1], shown: inflect(e[0], pos, form) });
    });
    if (picks.every(Boolean)) break;   // every slot filled; otherwise try another template
  }

  current = picks.map((p) => (p ? p.base : null));
  picks.forEach((p, i) => p && remember(LETTERS[i], p.base));
  LETTERS.forEach((l, i) => {
    const p = picks[i];
    let text = p ? p.shown : "(none)";
    if (i === 0 && t.slots[0][0] === "intj") text += ",";
    $(`word-${l}`).textContent = text;
    $(`score-${l}`).textContent = p && showZipf ? p.zipf : "";
  });
  $("template").textContent = t.name;

  const li = document.createElement("li");
  li.textContent = LETTERS.map((l) => $(`word-${l}`).textContent).join(" ");
  $("history").prepend(li);
}

// ---------- definitions popup ----------
function loadDefs() {
  defsLoading ||= fetch("defs.json")
    .then((r) => r.json())
    .then((d) => (defs = d));
  return defsLoading;
}

async function showDefinition(word) {
  if (!word || !words) return;
  $("def-word").textContent = word;
  $("def-list").replaceChildren();
  $("def-status").textContent = defs ? "" : "loading definitions...";
  $("def-dialog").showModal();

  try {
    await loadDefs();
  } catch {
    $("def-status").textContent = "couldn't load defs.json";
    return;
  }

  const entries = Object.hasOwn(defs, word) ? defs[word] : [];
  $("def-status").textContent = entries.length ? "" : "no definition found";
  $("def-list").replaceChildren(
    ...entries.map(([pos, gloss]) => {
      const li = document.createElement("li");
      const posEl = document.createElement("span");
      posEl.className = "pos";
      posEl.textContent = pos;
      li.append(posEl, gloss);   // append() treats strings as plain text, not HTML
      return li;
    })
  );
}

// Clicking a word looks up its base form ("quokka"), not the inflected one ("quokkas")
LETTERS.forEach((l, i) => {
  $(`word-${l}`).addEventListener("click", () => showDefinition(current[i]));
});

$("def-dialog").addEventListener("click", (e) => {
  if (e.target === $("def-dialog")) $("def-dialog").close();
});

// ---------- startup ----------
fetch("words.json")
  .then((r) => r.json())
  .then((data) => {
    words = data;
    logTemplateShares();   // open DevTools (F12) > Console to see the table
    $("word-p").textContent = "press generate";
    $("go").disabled = false;
    $("go").addEventListener("click", generate);
  })
  .catch(() => {
    $("word-p").textContent = "couldn't load words.json (open with Live Server)";
  });

document.addEventListener("keydown", (e) => {
  if (e.code === "Space" && words && !$("def-dialog").open) {
    e.preventDefault();
    generate();
  }
});