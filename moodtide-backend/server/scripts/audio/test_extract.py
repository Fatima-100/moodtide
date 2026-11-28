"""A36 tests with generated audio (no network, no database).
Run from moodtide-backend/server:  python -m unittest discover -s scripts/audio -v"""
import unittest

import numpy as np

import extract as x

SR = x.SR


def clicks(bpm, seconds=20, level=0.8):
    y = np.zeros(SR * seconds, dtype=np.float32)
    burst = (level * np.random.default_rng(1).uniform(-1, 1, 600) * np.linspace(1, 0, 600)).astype(np.float32)
    for start in range(0, y.size - 600, int(SR * 60 / bpm)):
        y[start:start + 600] = burst
    return y


def chord(freqs, seconds=10, level=0.05):
    t = np.arange(SR * seconds) / SR
    return (level * sum(np.sin(2 * np.pi * f * t) for f in freqs)).astype(np.float32)


class Features(unittest.TestCase):
    def test_tempo_and_regularity(self):
        raw = x.measure(clicks(120), SR)
        self.assertAlmostEqual(raw["tempo"], 120, delta=6)
        self.assertGreater(raw["regularity"], 0.8)

    def test_loud_busy_audio_has_more_energy_than_a_quiet_chord(self):
        loud, quiet = x.measure(clicks(150), SR), x.measure(chord([220, 277.2, 329.6], level=0.01), SR)
        norm = x.fit_norm([loud, quiet])
        self.assertGreater(x.to_features(loud, norm)["energy"], x.to_features(quiet, norm)["energy"])

    def test_major_scores_higher_than_minor(self):
        major = x.measure(chord([261.6, 329.6, 392.0]), SR)["mode"]
        minor = x.measure(chord([261.6, 311.1, 392.0]), SR)["mode"]
        self.assertGreater(major, 0.5)
        self.assertLess(minor, 0.5)

    def test_values_stay_in_the_database_ranges_and_tags_blend(self):
        raw = {"tempo": 400, "rms_db": 10, "onset": 99, "centroid": 99999, "regularity": 1, "mode": 1}
        norm = {"rms_db": [-40, -10], "onset": [0, 2], "centroid": [500, 4000]}
        f = x.to_features(raw, norm)
        self.assertEqual((f["energy"], f["happiness"], f["tempo"]), (1.0, 1.0, 220))
        self.assertEqual(x.to_features(raw, norm, tag_valence=0.0)["happiness"], 0.6)

    def test_silence_is_refused(self):
        with self.assertRaises(ValueError):
            x.measure(np.zeros(SR * 10, dtype=np.float32), SR)

    def test_youtube_is_never_a_source(self):
        with self.assertRaises(SystemExit):
            x.main(["--sources", "youtube"])

    def test_sample_is_half_calm_half_energetic(self):
        rows = [{"energy": i / 100, "title": str(i)} for i in range(100)]
        picked = x.pick_sample(rows, 20)
        self.assertEqual(sum(r["energy"] < 0.5 for r in picked), 10)
        self.assertEqual(len(picked), 20)


if __name__ == "__main__":
    unittest.main()
