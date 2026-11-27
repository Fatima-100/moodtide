// Onboarding rules that need no database (task A31).

export const LANGUAGES = ['urdu', 'punjabi', 'english', 'hindi', 'korean', 'japanese'];
export const LISTENING_TIMES = ['morning', 'afternoon', 'evening', 'night'];

export const AFFINITY_CHOSEN = 4;    // a genre the user picked
export const AFFINITY_OTHER = 2.5;   // every other music genre (also the engine's own default for an unknown genre)

// the region of the music each language is sung in (songs.region)
const LANGUAGE_REGION = { urdu: 'pakistani', punjabi: 'punjabi', english: 'international', hindi: 'indian', korean: 'korean', japanese: 'japanese' };
const ASIAN = ['indian', 'korean', 'japanese'];

/**
 * The region preference (users.region_pref) for the chosen languages, or null when no language was chosen
 * (then the saved preference is left alone).
 *   one language                       -> its region (urdu -> 'pakistani')
 *   only Hindi / Korean / Japanese     -> 'asian'
 *   anything else mixed                -> 'all', because region_pref holds ONE value and 'all' hides nothing
 */
export function regionFromLanguages(languages) {
  const regions = [...new Set(languages.map((l) => LANGUAGE_REGION[l]).filter(Boolean))];
  if (regions.length === 0) return null;
  if (regions.length === 1) return regions[0];
  return regions.every((r) => ASIAN.includes(r)) ? 'asian' : 'all';
}
