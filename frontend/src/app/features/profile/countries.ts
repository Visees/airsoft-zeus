/** Countries offered in the profile picker (ISO 3166-1 alpha-2). Any other value is stored as free text. */
export const COMMON_COUNTRIES = [
  'AT', 'AU', 'BE', 'BG', 'BR', 'CA', 'CH', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FR', 'GB', 'GR', 'HR', 'HU',
  'IE', 'IT', 'JP', 'LT', 'LU', 'LV', 'MT', 'MX', 'NL', 'NO', 'NZ', 'PL', 'PT', 'RO', 'RS', 'SE', 'SI', 'SK',
  'UA', 'US', 'ZA',
] as const;

const names = (() => {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' });
  } catch {
    return null;
  }
})();

/** "IT" → "Italy"; free text is returned as is. */
export function countryName(value: string | null | undefined): string | null {
  if (!value) return null;
  if (/^[A-Za-z]{2}$/.test(value)) {
    try {
      return names?.of(value.toUpperCase()) ?? value;
    } catch {
      return value;
    }
  }
  return value;
}

export function countryOptions(): { code: string; name: string }[] {
  return COMMON_COUNTRIES.map((code) => ({ code, name: countryName(code) ?? code })).sort((a, b) => a.name.localeCompare(b.name));
}

export const LANGUAGES: { code: string; name: string }[] = [
  { code: 'en', name: 'English' },
  { code: 'it', name: 'Italiano' },
  { code: 'de', name: 'Deutsch' },
  { code: 'fr', name: 'Français' },
  { code: 'es', name: 'Español' },
];
