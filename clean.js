import Database from 'better-sqlite3';
const db = new Database('words.db');

const p = db.exec(`
    UPDATE words SET status = 'keep', note = NULL WHERE note = 'explicit words';`);
/*
const bad_words = db.exec(`
    UPDATE words SET status='drop', note='explicit words'
    WHERE id IN (SELECT word_id FROM word_tags WHERE tag IN ('vulgar','offensive','derogatory','slur','ethnic','pejorative'))
    `);

/*
const manual = db.exec(`
    UPDATE words SET status='drop', note='manual' WHERE word = 'Q+';`);
*/