// One pass over the dump to see what's actually in the p/q/c entries before deciding any filters.
// Usage: node explore-pqc.js kaikki.org-dictionary-English.jsonl
// Output: report/ folder with sorted counts + random example words for each value.

const fs = require("fs");
const readline = require("readline");

const INPUT = process.argv[2] || "kaikki.org-dictionary-English-words.jsonl";
const SAMPLES = 8; // example words kept per value

// counter: value -> { n, samples[] } using reservoir sampling so examples are random, not alphabetical
function makeCounter() { return new Map(); }
function bump(counter, value, word) {
  let c = counter.get(value);
  if (!c) { c = { n: 0, samples: [] }; counter.set(value, c); }
  c.n++;
  if (c.samples.length < SAMPLES) c.samples.push(word);
  else {
    const j = Math.floor(Math.random() * c.n);
    if (j < SAMPLES) c.samples[j] = word;
  }
}

const counters = {
  pos: makeCounter(),            // part of speech
  senseTags: makeCounter(),      // senses[].tags
  enCategories: makeCounter(),   // senses[].categories with langcode "en" (topical)
  topLevelKeys: makeCounter(),   // which fields entries actually have
  senseKeys: makeCounter(),      // which fields senses actually have
  glossLabels: makeCounter(),    // "(slang, Australia)" style labels found in raw_glosses
  firstChar: makeCounter(),      // character types: lowercase, Capital, ALLCAPS, has space, etc.
};

let lines = 0, entries = 0, noTagEntries = 0, noGlossEntries = 0;

function shape(w) {
  const out = [];
  if (/\s/.test(w)) out.push("multi-word");
  if (/-/.test(w)) out.push("hyphen");
  if (/[^\p{L}\s'-]/u.test(w)) out.push("other-chars");
  if (/[^\x00-\x7F]/.test(w)) out.push("non-ascii");
  if (w.length > 1 && w === w.toUpperCase() && /\p{L}/u.test(w)) out.push("ALLCAPS");
  else if (/^\p{Lu}/u.test(w)) out.push("Capitalized");
  else out.push("lowercase");
  return out;
}

const rl = readline.createInterface({
  input: fs.createReadStream(INPUT, { encoding: "utf8" }),
  crlfDelay: Infinity,
});

rl.on("line", (line) => {
  lines++;
  if (lines % 500000 === 0) console.log(`${lines.toLocaleString()} lines...`);
  let e;
  try { e = JSON.parse(line); } catch { return; }
  const w = e.word?.trim();
  if (!w || !/^[pqc]/i.test(w)) return;
  entries++;

  bump(counters.pos, e.pos || "(none)", w);
  for (const k of Object.keys(e)) bump(counters.topLevelKeys, k, w);
  for (const s of shape(w)) bump(counters.firstChar, s, w);

  let anyTag = false, anyGloss = false;
  for (const s of e.senses || []) {
    for (const k of Object.keys(s)) bump(counters.senseKeys, k, w);
    for (const t of s.tags || []) { anyTag = true; bump(counters.senseTags, t, w); }
    for (const c of s.categories || []) {
      if (c.langcode === "en" && c.name) bump(counters.enCategories, c.name, w);
    }
    if (s.glosses?.length) anyGloss = true;
    // labels in parentheses at the start of raw glosses, e.g. "(Australia, slang) A fool"
    for (const g of s.raw_glosses || []) {
      const m = g.match(/^\(([^)]+)\)/);
      if (m) for (const label of m[1].split(",")) bump(counters.glossLabels, label.trim(), w);
    }
  }
  if (!anyTag) noTagEntries++;
  if (!anyGloss) noGlossEntries++;
});

rl.on("close", () => {
  fs.mkdirSync("report", { recursive: true });
  for (const [name, counter] of Object.entries(counters)) {
    const rows = [...counter]
      .sort((a, b) => b[1].n - a[1].n)
      .map(([v, c]) => `${String(c.n).padStart(8)}  ${v}  ->  ${c.samples.join(" | ")}`);
    fs.writeFileSync(`report/${name}.txt`, rows.join("\n"));
    console.log(`report/${name}.txt  (${counter.size.toLocaleString()} distinct values)`);
  }
  const summary = [
    `lines read: ${lines.toLocaleString()}`,
    `p/q/c entries: ${entries.toLocaleString()}`,
    `entries with no sense tags: ${noTagEntries.toLocaleString()}`,
    `entries with no glosses: ${noGlossEntries.toLocaleString()}`,
  ].join("\n");
  fs.writeFileSync("report/summary.txt", summary);
  console.log("\n" + summary);
});