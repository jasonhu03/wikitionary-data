import Database from 'better-sqlite3';
const db = new Database('words.db');

const d = db.prepare(`
    SELECT letter,
        SUM(word GLOB '*[ -]*')                     AS multi_or_hyphen,
        SUM(word GLOB '[A-Z]*')                     AS capitalized,
        SUM(word NOT GLOB '*[^a-z]*')               AS plain_lowercase
    FROM words
    WHERE zipf >= 2.5 AND status != 'drop' AND inflection_only = 0
    GROUP BY letter;
    `).all();

console.log(d);