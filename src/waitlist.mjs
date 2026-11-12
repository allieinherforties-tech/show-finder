// Waitlist conversion, the finder's one ask. Conversion is waitlist only:
// no commerce, no advertising, per the approved build plan. The target URL is
// a single configuration value (WAITLIST_URL) so the CTA can be repointed per
// deploy without a code change. The finder embeds no third-party form and no
// external script: the block is first-party markup, the anchor is real HTML
// that works with JavaScript disabled, and the substitution happens on the
// server when index.html is served.

export const DEFAULT_WAITLIST_URL = 'https://parentpeptalks.com/';
export const WAITLIST_URL = process.env.WAITLIST_URL || DEFAULT_WAITLIST_URL;
export const WAITLIST_URL_PLACEHOLDER = '__WAITLIST_URL__';

/** Escape a URL for safe use inside a double-quoted href attribute. */
function escapeHref(url) {
  return url.replace(/"/g, '%22').replace(/</g, '%3c').replace(/>/g, '%3e');
}

/** Substitute the configured URL into the page markup at every occurrence. */
export function applyWaitlistUrl(html, url = WAITLIST_URL) {
  return html.split(WAITLIST_URL_PLACEHOLDER).join(escapeHref(url));
}
