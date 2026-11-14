// Watch-provider registry for the story-row link model.
//
// Riley's 2026-11-14 diction ruling: every watch button renders its label
// from the row's providerLabel, never a hardcoded platform string. The key
// is a plain string (PBS rows will carry direct video URLs, so there is no
// integration layer here and no fallback chain); the label is the exact
// display string the UI renders.
export const PROVIDERS = {
  apple: { key: 'apple', label: 'Apple TV+' },
  pbs: { key: 'pbs', label: 'PBS KIDS' },
  disney: { key: 'disney', label: 'Disney+' },
};

/** The display label for a provider key, or null when the key is unknown. */
export function providerLabel(provider) {
  return PROVIDERS[provider]?.label || null;
}
