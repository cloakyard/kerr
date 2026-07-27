/**
 * Find tags that would *fetch* something from another origin.
 *
 * Only resource loads matter for the CSP. `<link rel="canonical">` and
 * `<meta property="og:url">` name a URL without ever requesting it, so they
 * are metadata, not a policy violation — flagging them would train you to
 * ignore the check, which is worse than not having it.
 */
const LOADS = /<(script|link|img|iframe|source|video|audio|embed|object|track)\b[^>]*>/gi;
const URL_ATTR = /\b(?:src|href|data)\s*=\s*"((?:https?:)?\/\/[^"]+)"/i;
const METADATA_REL = /\brel\s*=\s*"(?:canonical|alternate|me|author|license|manifest-src)"/i;

export function externalLoads(html) {
  const found = [];
  for (const [tag] of html.matchAll(LOADS)) {
    const url = tag.match(URL_ATTR);
    if (!url) continue;
    if (/^<link\b/i.test(tag) && METADATA_REL.test(tag)) continue;
    found.push(tag.length > 120 ? tag.slice(0, 117) + '…' : tag);
  }
  return found;
}
