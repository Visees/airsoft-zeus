// Clipboard / Web Share helpers used by the event and results screens (browser only).

/** Copy text to the clipboard. Falls back to a hidden textarea on older browsers. */
export async function copyText(text: string): Promise<boolean> {
  if (typeof navigator === 'undefined' || typeof document === 'undefined') return false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

export type ShareOutcome = 'shared' | 'copied' | 'cancelled' | 'failed';

/** Native share sheet when available, otherwise copy the URL. */
export async function shareOrCopy(data: { title: string; text?: string; url: string }): Promise<ShareOutcome> {
  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share(data);
      return 'shared';
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return 'cancelled';
      // Some browsers expose share() but refuse it (e.g. insecure context): copy instead.
    }
  }
  return (await copyText(data.url)) ? 'copied' : 'failed';
}

/** Public deep link that opens the join screen with the code prefilled. */
export function joinLink(origin: string, code: string): string {
  return `${origin}/events/join?code=${encodeURIComponent(code)}`;
}

/** Join codes are 6–10 uppercase letters/digits. */
export const JOIN_CODE_PATTERN = /^[A-Z0-9]{6,10}$/;

/** Uppercase and strip spaces/dashes that people type when reading a code aloud. */
export function normalizeCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
}

/**
 * Extract a join code from a scanned QR payload: either a URL ending in
 * /events/join?code=XXXX or the raw code. Returns null when it is neither.
 */
export function codeFromQr(payload: string): string | null {
  const text = payload.trim();
  try {
    const url = new URL(text);
    const code = url.searchParams.get('code');
    if (code && /\/events\/join\/?$/.test(url.pathname)) {
      const c = normalizeCode(code);
      return JOIN_CODE_PATTERN.test(c) ? c : null;
    }
    return null;
  } catch {
    /* not a URL */
  }
  const m = text.match(/events\/join\?(?:.*&)?code=([A-Za-z0-9-]+)/);
  if (m) {
    const c = normalizeCode(m[1]);
    return JOIN_CODE_PATTERN.test(c) ? c : null;
  }
  // Raw code: only letters/digits (spaces and dashes tolerated), nothing else.
  const raw = text.replace(/[\s-]/g, '').toUpperCase();
  return JOIN_CODE_PATTERN.test(raw) ? raw : null;
}
