import Database from 'better-sqlite3';
const db = new Database('words.db');

const entry_count = db.prepare(`
    SELECT COUNT(*) FROM word_pos
    `).all();

const pos = db.prepare(`
    SELECT w.word, COUNT(*) n from words w
    JOIN word_pos p ON p.word_id = w.id
    GROUP BY w.id ORDER BY n DESC LIMIT 20
    `).all();

const common = db.prepare(`
    SELECT w.word, w.zipf
    FROM words w
    WHERE w.status = 'keep'
    ORDER BY w.zipf DESC LIMIT 20
    `).all();

const random = db.prepare(`
    SELECT w.word, w.zipf, p.pos, p.gloss
    FROM words w JOIN word_pos p ON p.word_id = w.id
    WHERE w.status = 'keep'
    ORDER BY random() LIMIT 50
    `).all();

const count = db.prepare(`
    SELECT w.letter, COUNT(*) count FROM words w
    WHERE w.status = 'keep'
    GROUP BY w.letter ORDER BY count DESC
    `).all();

const commoness = db.prepare(`
    SELECT w.letter, p.pos,
        SUM(w.zipf >= 4) AS common,
        SUM(w.zipf >= 2.5 AND w.zipf < 4) AS known,
        SUM(w.zipf < 2.5) AS rare
    FROM words w JOIN word_pos p ON p.word_id = w.id
    GROUP BY w.letter, p.pos
    HAVING p.pos IN ('noun','verb','adj','adv','name')
    ORDER BY w.letter, p.pos`).all();

const pruned_count = db.prepare(`
    SELECT w.letter, COUNT(*) count FROM words w
    WHERE w.inflection_only = 0
        AND w.multi_word = 0
        AND w.id NOT IN (SELECT word_id FROM word_tags WHERE tag IN ('vulgar','offensive','derogatory','slur','ethnic','pejorative'))
    GROUP BY w.letter ORDER BY count DESC
    `).all();

const pruned = db.prepare(`
    SELECT w.letter, p.pos,
        SUM(w.zipf >= 4) AS common,
        SUM(w.zipf >= 2.5 AND w.zipf < 4) AS known,
        SUM(w.zipf < 2.5) AS rare
    FROM words w JOIN word_pos p ON p.word_id = w.id
    WHERE w.inflection_only = 0
        AND w.multi_word = 0
        AND w.id NOT IN (SELECT word_id FROM word_tags WHERE tag IN ('vulgar','offensive','derogatory','slur','ethnic','pejorative'))
    GROUP BY w.letter, p.pos
    HAVING p.pos IN ('noun','verb','adj','adv','name')
    ORDER BY w.letter, p.pos`).all();

console.log(pruned_count);


    /*
const qq = db.prepare(`
    SELECT w.id, w.word, w.zipf FROM words w
    WHERE w.status = 'keep'
        AND w.letter = 'q'
        AND w.inflection_only = 0
        AND w.multi_word = 0
        AND w.id NOT IN (SELECT word_id FROM word_tags WHERE tag IN ('vulgar','offensive','derogatory','slur','ethnic','pejorative'))
    ORDER BY w.zipf DESC
    `).all();

import fs from 'node:fs';

fs.writeFileSync('q.json', JSON.stringify(qq,null,2));


/*
console.log(count);
console.log(commoness);
console.log(pruned_count);
console.log(pruned);
*/