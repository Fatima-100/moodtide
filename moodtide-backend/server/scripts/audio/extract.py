#!/usr/bin/env python3
"""MoodTide A36: measured audio features for audio we may process (Jamendo, Audius, approved uploads).
YouTube is never downloaded. The formulas are explained in docs/features.md.

Run from moodtide-backend/server (inside the virtual environment):
  python scripts/audio/extract.py --dry-run --limit 5     test: measure 5 tracks, save nothing
  python scripts/audio/extract.py                         measure what is left, then write the features
  python scripts/audio/extract.py --sample 20             write docs/audio-sample.html (listening check)
  python scripts/audio/extract.py --sql-out reports/measured.sql    SQL for the hosted database (Neon)

Other flags: --sources jamendo,audius,creator   --refit (recompute the normalisation bounds)
             --api http://localhost:4000 (only needed for creator uploads: the server signs the link)
The raw measurements are kept in scripts/audio/raw-features.json, so a stopped run continues where it
left off and changed formulas can be applied again without downloading anything.
"""
import argparse
import html
import json
import os
import random
import sys
import tempfile
import time
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
SERVER = HERE.parents[1]
REPO = SERVER.parents[1]
CACHE = HERE / "raw-features.json"
NORM = HERE / "norm.json"
SOURCES = ("jamendo", "audius", "creator")      # never youtube
SR = 22050
CLIP_SECONDS = 60
MAX_BYTES = 60 * 1024 * 1024

# Krumhansl-Kessler key profiles
MAJOR = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
MINOR = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])
TAG_BLEND = 0.4


def clip01(x):
    return float(min(1.0, max(0.0, x)))


def mode_major_score(chroma_mean):
    """0 = clearly minor, 0.5 = unclear, 1 = clearly major."""
    if not np.any(chroma_mean) or np.std(chroma_mean) == 0:
        return 0.5
    best = [max(np.corrcoef(chroma_mean, np.roll(p, k))[0, 1] for k in range(12)) for p in (MAJOR, MINOR)]
    return clip01(0.5 + 2.5 * (best[0] - best[1]))


def measure(y, sr):
    """Raw measurements of one piece of audio."""
    import librosa
    if y.size < sr * 5 or not np.any(np.abs(y) > 1e-4):
        raise ValueError("audio is silent or shorter than 5 seconds")
    onset = librosa.onset.onset_strength(y=y, sr=sr)
    tempo, beats = librosa.beat.beat_track(onset_envelope=onset, sr=sr)
    gaps = np.diff(librosa.frames_to_time(beats, sr=sr))
    regularity = clip01(1 - np.std(gaps) / np.mean(gaps)) if gaps.size >= 3 else 0.0
    rms = float(np.mean(librosa.feature.rms(y=y)))
    chroma = librosa.feature.chroma_cqt(y=y, sr=sr)
    return {
        "tempo": float(np.atleast_1d(tempo)[0]),
        "rms_db": float(20 * np.log10(rms + 1e-9)),
        "onset": float(np.mean(onset)),
        "centroid": float(np.mean(librosa.feature.spectral_centroid(y=y, sr=sr))),
        "regularity": regularity,
        "mode": mode_major_score(chroma.mean(axis=1)),
    }


def load_middle(path):
    """Up to 60 seconds from the middle of the file, mono."""
    import librosa
    length = librosa.get_duration(path=path)
    return librosa.load(path, sr=SR, mono=True, offset=max(0.0, (length - CLIP_SECONDS) / 2), duration=CLIP_SECONDS)


def fit_norm(raws):
    """5th and 95th percentile of each loudness-like measurement over the whole set."""
    return {k: [float(np.percentile([r[k] for r in raws], p)) for p in (5, 95)] for k in ("rms_db", "onset", "centroid")}


def scale(x, bounds):
    low, high = bounds
    return 0.5 if high <= low else clip01((x - low) / (high - low))


def to_features(raw, norm, tag_valence=None):
    rms = scale(raw["rms_db"], norm["rms_db"])
    onset = scale(raw["onset"], norm["onset"])
    bright = scale(raw["centroid"], norm["centroid"])
    tempo = raw["tempo"] if raw["tempo"] > 0 else 100.0
    tempo_score = clip01((tempo - 60) / 120)
    energy = 0.6 * rms + 0.4 * onset
    happiness = 0.5 * raw["mode"] + 0.3 * bright + 0.2 * tempo_score
    if tag_valence is not None:
        happiness = (1 - TAG_BLEND) * happiness + TAG_BLEND * tag_valence
    dance = 0.6 * raw["regularity"] + 0.4 * clip01(1 - abs(tempo - 120) / 80)
    return {"energy": round(clip01(energy), 3), "happiness": round(clip01(happiness), 3),
            "tempo": int(round(min(220, max(40, tempo)))), "danceability": round(clip01(dance), 3)}


# ---------- database ----------
def read_env(path=SERVER / ".env"):
    env = {}
    if path.exists():
        for line in path.read_text(encoding="utf-8-sig").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip().strip("\"'")
    env.update(os.environ)
    return env


def connect():
    import psycopg
    env = read_env()
    if env.get("DATABASE_URL"):
        print("Database: HOSTED (DATABASE_URL is set)")
        return psycopg.connect(env["DATABASE_URL"])
    host = env.get("DB_SERVER") or "localhost"
    print(f"Database: {host}")
    return psycopg.connect(host=host, port=env.get("DB_PORT") or 5432, dbname=env.get("DB_NAME") or "moodtide",
                           user=env.get("DB_USER") or "moodtide", password=env.get("DB_PASSWORD") or "")


def eligible(db, sources):
    rows = db.execute(
        """SELECT s.song_id, s.source, s.title, ar.name, s.audio_url, f.feature_source
           FROM songs s JOIN artists ar ON ar.artist_id = s.artist_id
           LEFT JOIN song_features f ON f.song_id = s.song_id
           WHERE s.is_active AND s.source = ANY(%s) AND coalesce(s.audio_url, '') <> ''
           ORDER BY s.song_id""", (list(sources),)).fetchall()
    keys = ("song_id", "source", "title", "artist", "url", "feature_source")
    return [dict(zip(keys, r)) for r in rows]


def tag_valences(db):
    """How positive a song's tags are (0 to 1), from tag_mood_map and the happiness of each mood in engine.js."""
    rows = db.execute(
        """SELECT st.song_id, (sum(st.weight * m.weight * h.v) / nullif(sum(st.weight * m.weight), 0))::float8
           FROM song_tags st
           JOIN tag_mood_map m ON m.tag = st.tag
           JOIN (VALUES ('happy', 0.85), ('calm', 0.65), ('sad', 0.22), ('energetic', 0.72), ('stressed', 0.28)) h(mood, v)
             ON h.mood = m.mood
           WHERE st.weight > 0 GROUP BY st.song_id""").fetchall()
    return {song: v for song, v in rows if v is not None}


def apply_features(db, songs, cache, norm):
    valence = tag_valences(db)
    n = 0
    for s in songs:
        raw = cache.get(s["song_id"])
        if not raw:
            continue
        f = to_features(raw, norm, valence.get(s["song_id"]))
        # acousticness is not measured: an existing value stays, a new row gets 0.5
        db.execute(
            """INSERT INTO song_features (song_id, energy, happiness, tempo, danceability, acousticness, feature_source)
               VALUES (%(id)s, %(energy)s, %(happiness)s, %(tempo)s, %(danceability)s, 0.5, 'measured')
               ON CONFLICT (song_id) DO UPDATE SET energy = EXCLUDED.energy, happiness = EXCLUDED.happiness,
                 tempo = EXCLUDED.tempo, danceability = EXCLUDED.danceability, feature_source = 'measured'""",
            {"id": s["song_id"], **f})
        n += 1
    return n


def measured_sql(db):
    rows = db.execute(
        """SELECT f.song_id, f.energy, f.happiness, f.tempo, f.danceability, f.acousticness
           FROM song_features f JOIN songs s ON s.song_id = f.song_id
           WHERE f.feature_source = 'measured' AND s.source <> 'youtube' ORDER BY f.song_id""").fetchall()
    out = [f"-- {len(rows)} measured feature rows from the local catalog", "BEGIN;"]
    for song, e, h, t, d, a in rows:
        sid = "'" + song.replace("'", "''") + "'"
        out.append(
            "INSERT INTO song_features (song_id, energy, happiness, tempo, danceability, acousticness, feature_source) "
            f"SELECT {sid}, {e}, {h}, {t}, {d}, {a}, 'measured' WHERE EXISTS (SELECT 1 FROM songs WHERE song_id = {sid}) "
            "ON CONFLICT (song_id) DO UPDATE SET energy = EXCLUDED.energy, happiness = EXCLUDED.happiness, "
            "tempo = EXCLUDED.tempo, danceability = EXCLUDED.danceability, feature_source = 'measured';")
    out.append("COMMIT;")
    return "\n".join(out) + "\n"


# ---------- listening check ----------
PAGE = """<!doctype html><meta charset="utf-8"><title>MoodTide listening check</title>
<style>body{font:16px system-ui;max-width:720px;margin:24px auto;padding:0 16px}li{margin-bottom:18px}audio{width:100%}textarea{width:100%;height:320px}</style>
<h1>Calm or energetic?</h1><p>Listen to each track and choose. The measured values are shown only at the end.</p>
<ol id="list"></ol><button id="go">Show result</button><p id="score"></p><textarea id="out" hidden readonly></textarea>
<script>
const tracks = __DATA__;
tracks.forEach((t, i) => {
  const li = document.createElement('li'); const name = document.createElement('div'); name.textContent = t.artist + ' - ' + t.title; li.append(name);
  const a = document.createElement('audio'); a.controls = true; a.preload = 'metadata'; a.src = t.url;
  a.addEventListener('loadedmetadata', () => { if (isFinite(a.duration) && a.duration > 60) a.currentTime = (a.duration - 60) / 2; }, { once: true });
  a.addEventListener('play', () => document.querySelectorAll('audio').forEach(o => o !== a && o.pause()));
  li.append(a);
  for (const v of ['calm', 'energetic']) { const l = document.createElement('label'); const r = document.createElement('input'); r.type = 'radio'; r.name = 't' + i; r.value = v; l.append(r, ' ' + v + '   '); li.append(l); }
  document.getElementById('list').append(li);
});
document.getElementById('go').onclick = () => {
  const picks = tracks.map((_, i) => document.querySelector('input[name=t' + i + ']:checked')?.value);
  const score = document.getElementById('score');
  if (picks.some(p => !p)) { score.textContent = 'Choose calm or energetic for every track first.'; return; }
  let ok = 0; const rows = tracks.map((t, i) => { const model = t.energy < 0.5 ? 'calm' : 'energetic'; const same = model === picks[i]; ok += same;
    return '| ' + (i + 1) + ' | ' + (t.artist + ' - ' + t.title).replaceAll('|', '/') + ' | ' + picks[i] + ' | ' + model + ' (' + t.energy.toFixed(2) + ') | ' + (same ? 'yes' : 'no') + ' |'; });
  score.textContent = 'Agreement: ' + ok + ' of ' + tracks.length;
  const out = document.getElementById('out'); out.hidden = false;
  out.value = 'Agreement: ' + ok + ' of ' + tracks.length + '\\n\\n| # | Track | My judgement | Measured (energy) | Match |\\n|---|---|---|---|---|\\n' + rows.join('\\n') + '\\n';
};
</script>
"""


def pick_sample(rows, n, seed=36):
    """Half from the measured-calm side, half from the energetic side, in random order."""
    rng = random.Random(seed)
    calm = [r for r in rows if r["energy"] < 0.5]
    loud = [r for r in rows if r["energy"] >= 0.5]
    a = rng.sample(calm, min(len(calm), n // 2))
    b = rng.sample(loud, min(len(loud), n - len(a)))
    out = a + b
    rng.shuffle(out)
    return out


def write_sample(db, n):
    rows = db.execute(
        """SELECT s.title, ar.name, s.audio_url, f.energy::float8
           FROM songs s JOIN artists ar ON ar.artist_id = s.artist_id JOIN song_features f ON f.song_id = s.song_id
           WHERE s.is_active AND s.source <> 'youtube' AND f.feature_source = 'measured' AND s.audio_url LIKE 'http%%'
           ORDER BY s.song_id""").fetchall()
    chosen = pick_sample([dict(zip(("title", "artist", "url", "energy"), r)) for r in rows], n)
    data = json.dumps(chosen, ensure_ascii=False).replace("<", "\\u003c")
    path = REPO / "docs" / "audio-sample.html"
    path.write_text(PAGE.replace("__DATA__", data), encoding="utf-8")
    print(f"{len(chosen)} tracks -> {path}")


# ---------- main ----------
def download(url, path):
    import requests
    with requests.get(url, stream=True, timeout=60) as r:
        r.raise_for_status()
        size = 0
        with open(path, "wb") as out:
            for chunk in r.iter_content(65536):
                size += len(chunk)
                if size > MAX_BYTES:
                    raise ValueError("file is too large")
                out.write(chunk)


def audio_url(song, api):
    if song["source"] != "creator":
        return song["url"]
    import requests
    r = requests.get(f"{api.rstrip('/')}/api/songs/{song['song_id']}/stream", timeout=30)
    r.raise_for_status()
    return r.json()["stream_url"]


def measure_song(song, api):
    with tempfile.TemporaryDirectory() as tmp:          # the audio is deleted right after measuring
        ext = ".aac" if ".aac" in song["url"] else ".mp3"
        path = os.path.join(tmp, "track" + ext)
        download(audio_url(song, api), path)
        return measure(*load_middle(path))


def save_json(path, data):
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, indent=1), encoding="utf-8")
    tmp.replace(path)


def main(argv=None):
    p = argparse.ArgumentParser(description="Measured audio features (A36)")
    p.add_argument("--limit", type=int, default=0, help="measure at most this many new tracks")
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--refit", action="store_true")
    p.add_argument("--min-fit", type=int, default=50)
    p.add_argument("--sources", default=",".join(SOURCES))
    p.add_argument("--api", default="http://localhost:4000")
    p.add_argument("--sample", type=int, default=0)
    p.add_argument("--sql-out", default="")
    p.add_argument("--report", default=str(REPO / "docs" / "features-report.txt"))
    a = p.parse_args(argv)
    sources = [s.strip() for s in a.sources.split(",") if s.strip()]
    if not sources or any(s not in SOURCES for s in sources):
        sys.exit(f"--sources may only contain: {', '.join(SOURCES)} (YouTube audio is never processed)")

    with connect() as db:
        if a.sample:
            return write_sample(db, a.sample)
        if a.sql_out:
            out = Path(a.sql_out)
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_text(measured_sql(db), encoding="utf-8")
            return print(f"Saved {out}")

        songs = eligible(db, sources)
        db.commit()                                      # no open transaction during the slow part
        cache = json.loads(CACHE.read_text(encoding="utf-8")) if CACHE.exists() else {}
        todo = [s for s in songs if s["song_id"] not in cache and s["feature_source"] != "measured"]
        if a.dry_run and not a.limit:
            a.limit = 5
        if a.limit:
            todo = todo[: a.limit]
        print(f"{len(songs)} eligible tracks, {len(todo)} to measure now.")

        failed, started = [], time.time()
        for i, s in enumerate(todo, 1):
            try:
                raw = measure_song(s, a.api)
                cache[s["song_id"]] = raw
                print(f"{i}/{len(todo)}  tempo {raw['tempo']:5.0f}  {raw['rms_db']:6.1f} dB  {s['artist']} - {s['title']}")
            except Exception as e:                       # one bad track must not stop the run
                failed.append(s)
                print(f"{i}/{len(todo)}  FAILED {s['song_id']}: {str(e)[:150] or type(e).__name__}")
            if not a.dry_run and (i % 10 == 0 or i == len(todo)):
                save_json(CACHE, cache)
        print(f"Measured {len(todo) - len(failed)}, failed {len(failed)}, in {(time.time() - started) / 60:.1f} min.")
        if a.dry_run:
            return print("Dry run: nothing is saved.")

        have = [cache[s["song_id"]] for s in songs if s["song_id"] in cache]
        if a.refit or not NORM.exists():
            if len(have) < a.min_fit:
                return print(f"Only {len(have)} measurements: {a.min_fit} are needed to set the bounds. Nothing written to the database.")
            save_json(NORM, fit_norm(have))
            print(f"Normalisation bounds set from {len(have)} tracks -> {NORM.name}")
        norm = json.loads(NORM.read_text(encoding="utf-8"))
        written = apply_features(db, songs, cache, norm)
        db.commit()
        total = db.execute(
            """SELECT count(*) FROM song_features f JOIN songs s ON s.song_id = f.song_id
               WHERE s.is_active AND s.source <> 'youtube' AND f.feature_source = 'measured'""").fetchone()[0]
        lines = [
            f"MoodTide measured audio features, {time.strftime('%Y-%m-%d')}",
            f"Eligible non-YouTube tracks: {len(songs)}",
            f"Written in this run: {written}",
            f"Active non-YouTube tracks with measured values: {total} (target 500)",
            f"Failed in this run: {len(failed)}",
            "Normalisation bounds (5th, 95th percentile): " + json.dumps({k: [round(x, 3) for x in v] for k, v in norm.items()}),
            "NOTE: happiness is a PROXY (mode, brightness, tempo and tags). It is not a measurement of emotion.",
            "Acousticness is not measured.",
        ]
        print("\n" + "\n".join(lines))
        Path(a.report).parent.mkdir(parents=True, exist_ok=True)
        Path(a.report).write_text("\n".join(lines) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
