// export.js
// Builds the word list for the site from words.db.
//
// Writes:
//   words.json            { p: { noun: [[word, zipf, fun, wild, whimsy], ...], ... }, q: {...}, c: {...} }
//   defs.json             { word: [[pos, gloss], ...], ... }   (loaded when someone clicks a word)
//   wild-candidates.txt   auto-found wild words, best first, for you to skim
//
// Which words make it in:
//   familiar  plain lowercase single words with zipf >= FAMILIAR_FLOOR
//   wild      anything in wild.txt, plus uncommon words that score high on whimsy (AUTO_WILD_SCORE)
//   names     only what's in names.txt
//   never     anything in block.txt, anything with a risk tag, pure inflections,
//             multi-word / hyphenated / capitalized words unless they're in wild.txt or names.txt
//
// Usage: node export.js
const fs = require("fs");
const Database = require("better-sqlite3");

// ---------- knobs ----------
// zipf at or above this = familiar. q gets a lower floor because it has so few words.
const FAMILIAR_FLOOR = { p: 2.5, q: 1.5, c: 2.5 };
const AUTO_WILD_SCORE = 6;    // uncommon words scoring this high on whimsy become wild automatically
const AUTO_WILD_FLOOR = 0.5;  // ...but only if wordfreq has seen them at least a little
const MAYBE_SCORE = 5;        // words wordfreq has never seen, scoring this high, are listed for you to review
                              // in wild-candidates.txt (not shipped until you add them to wild.txt)

const POS = ["noun", "verb", "adj", "adv", "intj", "name"];
const RISK_TAGS = ["vulgar", "offensive", "derogatory", "slur", "ethnic", "pejorative", "sexual"];
const FUN_TAGS = ["humorous", "jocular", "childish", "onomatopoeic", "nonce-word", "endearing", "hypocoristic"];
const FUN_CATS = ["Animal sounds", "Sounds", "Laughter"];

// ---------- hand lists ----------
function readList(file) {
  if (!fs.existsSync(file)) return new Set();
  return new Set(fs.readFileSync(file, "utf8").split(/\r?\n/)
    .map((l) => l.trim()).filter((l) => l && !l.startsWith("#")));
}
const wildList = readList("wild.txt");    // always wild
const blockList = readList("block.txt");  // never shipped
const namesList = readList("names.txt");  // the ONLY names that ship (no politicians by accident)

// ---------- whimsy score: does the word sound playful? ----------
// Rewards bouncy endings, doubled letters, punchy consonants, repeated chunks.
// Penalizes jargon, but only for uncommon words ("pirate" and "chocolate" are fine).
const JARGON_END = /(ine|ol|yl|ide|ate|ase|ium|osis|itis|ism|ist|ity|tion|sion|ment|ness|ology|ical|ically|ometer|phyte|cyte|plasm|oid|ane|ene|one|ose|ic|ary|ory|ance|ence|ive|ous|al)$/;
const JARGON_START = /^(quasi|quadri|quinqu|quint|poly|pseudo|proto|pre|post|pro|para|peri|photo|phyto|phyl|chloro|cyclo|chemo|cardio|cranio|cyto|crypto|counter|contra)/;

function whimsy(word, zipf) {
  const w = word.toLowerCase();
  if (!/^[a-z]+$/.test(w)) return 0;      // multi-word, hyphenated, accented: neutral
  let s = 0;
  if (/(le|les|y|ey|ie|er|ock|ump|op|allop|ollop|el|oodle|amus|ampus|iddle|uffle|affle|iffle|izzle|uzzle|obbles)$/.test(w)) s += 3;
  if (/(.)\1/.test(w)) s += 1;
  if (/(bb|dd|gg|pp|ff|zz|ck|kk)/.test(w)) s += 1;
  if (/[kzbg]/.test(w)) s += 1;
  if (/oo|ump|uck|wh|ock|onk|unk|ank/.test(w)) s += 1;
  if (/^(\w{2,4}).*\1/.test(w) || /(\w{3}).*\1/.test(w)) s += 2;
  const n = w.length;
  if (n >= 6 && n <= 12) s += 1;
  if (n > 14) s -= 2;
  if (zipf < 3) {                          // jargon only matters for uncommon words
    if (JARGON_END.test(w)) s -= 4;
    if (JARGON_START.test(w)) s -= 3;
  }
  return s;
}

// ---------- load ----------
const db = new Database("words.db", { readonly: true });
const marks = (l) => l.map(() => "?").join(",");
const idsWhere = (sql, list) =>
  new Set(db.prepare(sql.replace("%", marks(list))).all(...list).map((r) => r.word_id));

const riskIds = idsWhere("SELECT DISTINCT word_id FROM word_tags WHERE tag IN (%)", RISK_TAGS);
const funIds = new Set([
  ...idsWhere("SELECT DISTINCT word_id FROM word_tags WHERE tag IN (%)", FUN_TAGS),
  ...idsWhere("SELECT DISTINCT word_id FROM word_categories WHERE category IN (%)", FUN_CATS),
]);

const rows = db.prepare(`
  SELECT w.id, w.word, w.letter, w.zipf, w.inflection_only, p.pos, p.gloss
  FROM words w JOIN word_pos p ON p.word_id = w.id
  WHERE w.status != 'drop'
`).all();

// ---------- build ----------
const words = {};
for (const l of ["p", "q", "c"]) {
  words[l] = {};
  for (const pos of POS) words[l][pos] = [];
}
const autoWild = [];   // shipped automatically; listed in the review file
const maybeWild = [];  // too rare to ship automatically; listed so you can hand-pick
const handFound = [];  // wild.txt words that made it in
const kept = new Set();

for (const r of rows) {
  if (!words[r.letter] || !words[r.letter][r.pos]) continue;
  if (blockList.has(r.word)) continue;
  const zipf = r.zipf || 0;
  const handWild = wildList.has(r.word);
  const handName = namesList.has(r.word);
  // names come only from names.txt
  if (r.pos === "name") {
    if (handName) { words[r.letter].name.push([r.word, +zipf.toFixed(2), 0, 0, 0]); kept.add(r.word); }
    continue;
  }
  const plain = /^[a-z]+$/.test(r.word);   // lowercase single word, no spaces or hyphens
  // hand-picked wild words skip every automatic rule; everything else must be clean
  if (!handWild && (riskIds.has(r.id) || r.inflection_only)) continue;

  const fun = funIds.has(r.id) ? 1 : 0;
  const score = whimsy(r.word, zipf) + (fun ? 2 : 0);
  const familiar = plain && zipf >= FAMILIAR_FLOOR[r.letter];
  const auto = plain && !familiar && !handWild && zipf >= AUTO_WILD_FLOOR &&
               score >= AUTO_WILD_SCORE;
  const isWild = handWild || auto;
  if (!familiar && !isWild) {
    if (plain && zipf < AUTO_WILD_FLOOR && score >= MAYBE_SCORE) {
      maybeWild.push({ ...r, score });
    }
    continue;
  }
  if (handWild) handFound.push({ ...r, score });

  words[r.letter][r.pos].push([r.word, +zipf.toFixed(2), fun, isWild ? 1 : 0, Math.max(0, score)]);
  kept.add(r.word);
  if (auto) autoWild.push({ ...r, score });
}
fs.writeFileSync("words.json", JSON.stringify(words));

// ---------- review file ----------
// Three sections per letter:
//   AUTO   shipped automatically (uncommon but whimsical). Block any you dislike.
//   MAYBE  too rare for wordfreq, so NOT shipped. Copy favorites into wild.txt.
//   HAND   your wild.txt words that made it in, for reference.
const fmt = (r) => `${r.word.padEnd(22)} ${String(r.score).padStart(2)}  ${r.pos.padEnd(5)} ${(r.gloss || "").slice(0, 70)}`;
const byScore = (a, b) => b.score - a.score || a.word.localeCompare(b.word);
const lines = ["# AUTO = shipped automatically (add dislikes to block.txt)",
               "# MAYBE = never seen by wordfreq, not shipped (copy favorites to wild.txt)",
               "# HAND = from your wild.txt", ""];
for (const l of ["p", "q", "c"]) {
  for (const [label, list] of [["AUTO", autoWild], ["MAYBE", maybeWild], ["HAND", handFound]]) {
    const mine = list.filter((r) => r.letter === l).sort(byScore);
    lines.push(`===== ${l.toUpperCase()} ${label} (${mine.length}) =====`, ...mine.map(fmt), "");
  }
}
fs.writeFileSync("wild-candidates.txt", lines.join("\n"));

// ---------- defs.json (only for words that shipped) ----------
const hasSenses = db.prepare(
  "SELECT name FROM sqlite_master WHERE type='table' AND name='senses'").get();
const defRows = db.prepare(hasSenses ? `
  SELECT w.word, s.pos, s.gloss FROM words w JOIN senses s ON s.word_id = w.id WHERE s.gloss != ''
` : `
  SELECT w.word, p.pos, p.gloss FROM words w JOIN word_pos p ON p.word_id = w.id WHERE p.gloss != ''
`).all();
const defs = Object.create(null);   // no inherited keys, so "constructor" is safe
for (const { word, pos, gloss } of defRows) {
  if (!kept.has(word)) continue;
  if (!defs[word]) defs[word] = [];
  defs[word].push([pos, gloss]);
}
fs.writeFileSync("defs.json", JSON.stringify(defs));

// ---------- summary ----------
const missingNames = [...namesList].filter((w) => !kept.has(w));
console.log(`names.txt: ${namesList.size - missingNames.length} found` +
  (missingNames.length ? `; not found as a name in the database: ${missingNames.join(", ")}` : ""));
const missing = [...wildList].filter((w) => !kept.has(w));
console.log(`wild.txt: ${wildList.size - missing.length} found` +
  (missing.length ? `; not found (spelling, capitals, or dropped): ${missing.join(", ")}` : ""));
console.log(`auto-wild: ${autoWild.length} shipped, ${maybeWild.length} more to review (see wild-candidates.txt)`);
console.log("pool sizes  familiar / wild");
for (const l of Object.keys(words)) {
  console.log(`  ${l}: ` + POS.map((p) => {
    const list = words[l][p];
    const w = list.filter((e) => e[3]).length;
    return `${p} ${list.length - w}/${w}`;
  }).join(", "));
}
for (const f of ["words.json", "defs.json"])
  console.log(`${f}: ${(fs.statSync(f).size / 1024).toFixed(0)} KB`);
db.close();