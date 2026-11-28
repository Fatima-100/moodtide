# Audio features (task A36)

Measured features come from `moodtide-backend/server/scripts/audio/extract.py`.
Only audio we may process is analysed: Jamendo, Audius and approved creator uploads. **YouTube audio is never
downloaded**, so YouTube songs keep estimated values. Audio is saved to a temporary file, measured and deleted.

## Measurements

60 seconds from the middle of each track (the whole track if shorter), mono, 22,050 Hz, with librosa.

| Name | How |
|---|---|
| tempo | `librosa.beat.beat_track` (BPM) |
| loudness | mean RMS, in dB |
| onset | mean onset strength |
| brightness | mean spectral centroid (Hz) |
| regularity | 1 minus (standard deviation / mean) of the time between beats |
| mode | best correlation of the average chroma with a major key profile minus the best with a minor one (Krumhansl-Kessler): `0.5 + 2.5 x difference`, limited to 0..1 |

## Normalisation

`n(x) = (x - p5) / (p95 - p5)`, limited to 0..1, where p5 and p95 are the 5th and 95th percentile of that
measurement over the tracks measured when the bounds were set (`scripts/audio/norm.json`). Values are therefore
relative to this catalog. `--refit` sets the bounds again.

## Formulas

- `energy = 0.6 x n(loudness) + 0.4 x n(onset)`
- `tempo_score = (tempo - 60) / 120`, limited to 0..1
- `happiness_proxy = 0.5 x mode + 0.3 x n(brightness) + 0.2 x tempo_score`
- `happiness = 0.6 x happiness_proxy + 0.4 x tag_valence` (the proxy alone when no tag maps to a mood)
- `tag_valence` = weighted average of the happiness of the moods a song's tags point to
  (happy 0.85, energetic 0.72, calm 0.65, stressed 0.28, sad 0.22; weights from `tag_mood_map`)
- `danceability = 0.6 x regularity + 0.4 x (1 - |tempo - 120| / 80)`
- acousticness is **not** measured; the earlier value is kept
- measured rows are saved with `feature_source = 'measured'`, and importers never overwrite them

## Limits

- **Happiness is a proxy.** Emotion cannot be measured from a signal; mode, brightness, tempo and tags are hints.
- The suggestion engine also reads tags (`w_tag`), so tags influence a measured song's mood match twice.
- Beat tracking can report half or double the real tempo.
- Loudness depends on how a track was mastered.
- The weights are choices of this project, not fitted to listener data.

## Listening check
Agreement: 16 of 20

| # | Track | My judgement | Measured (energy) | Match |
|---|---|---|---|---|
| 1 | Harveys - Usted se me llevo la vida (feat. Blow Rasta) | energetic | energetic (0.77) | yes |
| 2 | Kara Square - Annalise's Lullaby | calm | calm (0.32) | yes |
| 3 | Josh Woodward (Instrumental Versions) - Little Tomcat (Instrumental Version) | calm | calm (0.25) | yes |
| 4 | Wordsmith - Stacks | energetic | energetic (0.93) | yes |
| 5 | Roller Genoa - Safe and Warm in Hunter's Arms | energetic | energetic (0.79) | yes |
| 6 | Moira Waugh - Blackbird Song | calm | calm (0.28) | yes |
| 7 | Pianochocolate - August | calm | energetic (0.83) | no |
| 8 | Beatnik Aria - You Are | calm | calm (0.16) | yes |
| 9 | Ed Shulzhevsky - 100 Minutes | energetic | energetic (0.74) | yes |
| 10 | Oursvince - Falling Stars (Piano et orchestre) | calm | calm (0.32) | yes |
| 11 | Philippe Mangold - L'éther d'Afrique | calm | energetic (0.57) | no |
| 12 | Luke - Fight in my mind | calm | calm (0.20) | yes |
| 13 | Udo Vismann - Moment of Truth | calm | calm (0.20) | yes |
| 14 | Quietly Concerned - Moving Ground | calm | calm (0.42) | yes |
| 15 | KonstantinPazuzuStudio - Celtic Harp | calm | calm (0.00) | yes |
| 16 | Snowflake & ccMixter - Winter Sunlight (airtone feat. Leza2unes) | calm | calm (0.45) | yes |
| 17 | Alexander Stamenkovic - To sleep or not to sleep (Ivys song) | calm | energetic (0.53) | no |
| 18 | Samplastik - Focus-Pocus | energetic | energetic (0.96) | yes |
| 19 | starfirefive - Devotee | calm | energetic (0.51) | no |
| 20 | Manuzik - Oia | energetic | energetic (0.78) | yes |



Tempo is coarse: measured values fall on steps about 5% apart, so it is not exact BPM.

All 4 mismatches in the listening check were judged calm but measured energetic (3 between 0.51 and 0.57, 1 at 0.83), so energy may be overestimated for some calm tracks.
