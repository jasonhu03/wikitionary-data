// 1-import-db.js
// Step 1: stream the Wiktextract dump and load every p/q/c entry into words.db.
// Stores ALL sense tags and English categories (no guessing), so filtering decisions happen later in SQL.
// Usage: node 1-import-db.js kaikki.org-dictionary-English.jsonl
// Safe to re-run: it deletes and rebuilds words.db each time.

const fs = require("fs");
const readline = require("readline");
const Database = require("better-sqlite3");

const INPUT = process.argv[2] || "kaikki.org-dictionary-English.jsonl";
const DB_FILE = "words.db";

if (fs.existsSync(DB_FILE)) fs.unlinkSync(DB_FILE);
const db = new Database(DB_FILE);
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE words (
    id INTEGER PRIMARY KEY,
    word TEXT NOT NULL UNIQUE,       -- exact spelling; "Polish" and "polish" stay separate
    zipf REAL,                       -- filled in by step 2 (Python)
    inflection_only INTEGER NOT NULL,-- 1 if every sense is "plural of X", "past of X", etc.
    multi_word INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'keep',  -- keep / drop / review: you set this in step 3
    note TEXT                        -- why you dropped or flagged it
  );
  CREATE TABLE word_pos (word_id INTEGER, pos TEXT, gloss TEXT, UNIQUE(word_id, pos));
  CREATE TABLE word_tags (word_id INTEGER, tag TEXT, UNIQUE(word_id, tag));
  CREATE TABLE word_categories (word_id INTEGER, category TEXT, UNIQUE(word_id, category));
`);

// Collect in memory first (p/q/c subset fits easily), merging the multiple entries per word.
const words = new Map(); // exact word -> { pos: Map, tags: Set, cats: Set, inflectionOnly }
let lines = 0;

const rl = readline.createInterface({
  input: fs.createReadStream(INPUT, { encoding: "utf8" }),
  crlfDelay: Infinity,
});

rl.on("line", (line) => {
  lines++;
  if (lines % 500000 === 0) console.log(`${lines.toLocaleString()} lines read, ${words.size.toLocaleString()} words`);
  let e;
  try { e = JSON.parse(line); } catch { return; }
  const w = e.word?.trim();
  if (!w || !/^[pqc]/i.test(w)) return;
  if (e.lang_code && e.lang_code !== "en") return;

  let rec = words.get(w);
  if (!rec) {
    rec = { pos: new Map(), tags: new Set(), cats: new Set(), inflectionOnly: true };
    words.set(w, rec);
  }
  const senses = e.senses || [];
  const pos = e.pos || "unknown";
  if (!rec.pos.has(pos)) {
    const gloss = senses.find((s) => s.glosses?.length)?.glosses[0] || "";
    rec.pos.set(pos, gloss.slice(0, 200));
  }
  for (const s of senses) {
    for (const t of s.tags || []) rec.tags.add(t);
    for (const c of s.categories || []) if (c.langcode === "en" && c.name) rec.cats.add(c.name);
    if (!s.form_of && !s.alt_of) rec.inflectionOnly = false;
  }
});

rl.on("close", () => {
  console.log(`Parsed. Writing ${words.size.toLocaleString()} words to ${DB_FILE}...`);
  const insWord = db.prepare("INSERT INTO words (word, inflection_only, multi_word) VALUES (?, ?, ?)");
  const insPos = db.prepare("INSERT OR IGNORE INTO word_pos VALUES (?, ?, ?)");
  const insTag = db.prepare("INSERT OR IGNORE INTO word_tags VALUES (?, ?)");
  const insCat = db.prepare("INSERT OR IGNORE INTO word_categories VALUES (?, ?)");

  // One transaction for everything: without it, 260k inserts take ages.
  db.transaction(() => {
    for (const [w, rec] of words) {
      const id = insWord.run(w, rec.inflectionOnly ? 1 : 0, /\s/.test(w) ? 1 : 0).lastInsertRowid;
      for (const [p, g] of rec.pos) insPos.run(id, p, g);
      for (const t of rec.tags) insTag.run(id, t);
      for (const c of rec.cats) insCat.run(id, c);
    }
  })();

  db.exec(`
    CREATE INDEX idx_pos ON word_pos(pos);
    CREATE INDEX idx_tag ON word_tags(tag);
    CREATE INDEX idx_cat ON word_categories(category);
  `);
  const n = db.prepare("SELECT COUNT(*) n FROM words").get().n;
  console.log(`Done: ${n.toLocaleString()} words in ${DB_FILE}`);
  db.close();
});