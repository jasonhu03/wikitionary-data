# 2_add_freq.py
# Step 2: add a commonness score (Zipf scale) to every word in words.db using wordfreq.
#   ~7 = "the", 4-5 = everyday words, 2-3 = uncommon, <1.5 = very rare, 0 = never seen
# Setup:  pip install wordfreq
# Usage:  python 2_add_freq.py
# Safe to re-run.

import sqlite3
from wordfreq import zipf_frequency

db = sqlite3.connect("words.db")
rows = db.execute("SELECT id, word FROM words").fetchall()
print(f"Scoring {len(rows):,} words...")

updates = []
for i, (word_id, word) in enumerate(rows):
    updates.append((zipf_frequency(word, "en"), word_id))
    if i % 50000 == 0 and i:
        print(f"  {i:,}")

db.executemany("UPDATE words SET zipf = ? WHERE id = ?", updates)
db.commit()

buckets = db.execute("""
    SELECT CASE
        WHEN zipf >= 4   THEN '1 common   (4+)'
        WHEN zipf >= 2.5 THEN '2 known    (2.5-4)'
        WHEN zipf > 0    THEN '3 rare     (0-2.5)'
        ELSE                  '4 unseen   (0)'
    END AS bucket, COUNT(*)
    FROM words GROUP BY bucket ORDER BY bucket
""").fetchall()
for b, n in buckets:
    print(f"{b}  {n:,}")
db.close()