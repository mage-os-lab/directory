import sanitizeHtml from 'sanitize-html';

/**
 * README rendering: GitHub hands us *rendered* GFM (the REST readme endpoint
 * with the `html` media type), so the pipeline never parses Markdown itself —
 * it only has to make that third-party HTML safe and self-contained:
 *
 * - a strict tag/attribute allowlist (GitHub sanitizes its own output; this is
 *   the second, independent line of defence the architecture requires),
 * - relative links and images rewritten to absolute github.com/raw URLs, so a
 *   README rendered on our origin still points at the repository's files,
 * - ids and in-page anchors namespaced under `readme-`, so a README's own
 *   table of contents keeps working without its ids colliding with the
 *   detail page's,
 * - headings demoted one level: the page already owns the h1.
 */

/** Sanitized READMEs beyond this size are dropped rather than published. */
export const MAX_README_BYTES = 512 * 1024;

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);
const ID_PREFIX = 'readme-';
const HEADING_DEMOTION: Record<string, string> = {
  h1: 'h2',
  h2: 'h3',
  h3: 'h4',
  h4: 'h5',
  h5: 'h6',
  h6: 'h6',
};
const ALIGNMENTS = new Set(['left', 'center', 'right', 'justify']);

export interface ReadmeRepo {
  owner: string;
  repo: string;
}

/**
 * `HEAD` (rather than a pinned branch name) keeps both bases correct without
 * a second API call to learn the default branch — github.com and
 * raw.githubusercontent.com both resolve it.
 */
function linkBase({ owner, repo }: ReadmeRepo): string {
  return `https://github.com/${owner}/${repo}/blob/HEAD/`;
}

function imageBase({ owner, repo }: ReadmeRepo): string {
  return `https://raw.githubusercontent.com/${owner}/${repo}/HEAD/`;
}

/** Absolute, protocol-checked URL, or null when the value can't be used. */
function absolutize(value: string | undefined, base: string, httpsOnly = false): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed, base);
  } catch {
    return null;
  }
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) return null;
  if (httpsOnly && url.protocol !== 'https:') return null;
  return url.href;
}

/**
 * Namespace an anchor target. Applied identically to `id` attributes and to
 * fragment hrefs so a README's internal links still resolve; GitHub's own
 * `user-content-` prefix is stripped first so both sides agree.
 */
export function namespaceFragment(raw: string): string | null {
  let value = raw.replace(/^#/, '');
  try {
    value = decodeURIComponent(value);
  } catch {
    // Malformed percent-encoding: fall through with the raw value.
  }
  const cleaned = value
    .replace(/^user-content-/, '')
    .replace(/[^\p{L}\p{N}_.:-]/gu, '-')
    .replace(/^[-.:]+|[-.:]+$/gu, '');
  return cleaned ? `${ID_PREFIX}${cleaned}` : null;
}

/** Rewrite each candidate in a srcset; entries that don't survive are dropped. */
function rewriteSrcset(value: string | undefined, base: string): string | null {
  if (!value) return null;
  const rewritten = value
    .split(',')
    .map((candidate) => {
      const parts = candidate.trim().split(/\s+/);
      const url = absolutize(parts[0], base, true);
      if (!url) return null;
      return [url, ...parts.slice(1)].join(' ');
    })
    .filter((candidate): candidate is string => candidate !== null);
  return rewritten.length > 0 ? rewritten.join(', ') : null;
}

function keepNumeric(value: string | undefined): string | null {
  return value !== undefined && /^\d+$/.test(value.trim()) ? value.trim() : null;
}

function keepAlign(value: string | undefined): string | null {
  const align = value?.trim().toLowerCase();
  return align !== undefined && ALIGNMENTS.has(align) ? align : null;
}

const allowedTags = [
  'a', 'abbr', 'b', 'blockquote', 'br', 'caption', 'cite', 'code', 'dd', 'del', 'details',
  'div', 'dl', 'dt', 'em', 'figcaption', 'figure', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr',
  'i', 'img', 'input', 'ins', 'kbd', 'li', 'mark', 'ol', 'p', 'picture', 'pre', 'q', 's',
  'samp', 'small', 'source', 'span', 'strong', 'sub', 'summary', 'sup', 'table', 'tbody',
  'td', 'tfoot', 'th', 'thead', 'tr', 'ul', 'var',
];

/** Tags whose *contents* are dropped too — text inside them is markup, not prose. */
const nonTextTags = [
  'script', 'style', 'textarea', 'option', 'noscript', 'svg', 'math', 'template',
  'iframe', 'object', 'embed', 'form', 'button', 'select', 'audio', 'video', 'canvas', 'head',
];

/**
 * Sanitize one rendered README. Returns null when nothing publishable is left
 * (empty README, or one over MAX_README_BYTES).
 */
export function sanitizeReadme(html: string, repo: ReadmeRepo): string | null {
  const hrefBase = linkBase(repo);
  const srcBase = imageBase(repo);

  const clean = sanitizeHtml(html, {
    allowedTags,
    nonTextTags,
    // Every attribute the output carries is (re)built by the transform below;
    // this list is the second gate, so a tag the transform doesn't special-case
    // can never pass anything through.
    allowedAttributes: {
      a: ['href', 'id', 'title', 'rel', 'target'],
      img: ['src', 'alt', 'title', 'width', 'height', 'loading', 'align', 'id'],
      source: ['srcset', 'media', 'type', 'sizes'],
      input: ['type', 'checked', 'disabled'],
      td: ['align', 'colspan', 'rowspan', 'id'],
      th: ['align', 'colspan', 'rowspan', 'id'],
      div: ['align', 'id'],
      p: ['align', 'id'],
      h1: ['align', 'id'],
      h2: ['align', 'id'],
      h3: ['align', 'id'],
      h4: ['align', 'id'],
      h5: ['align', 'id'],
      h6: ['align', 'id'],
      '*': ['id'],
    },
    // `source` is void; without this it would be serialized with a stray
    // closing tag (harmless, but it shows up in the published HTML).
    selfClosing: ['img', 'br', 'hr', 'area', 'base', 'basefont', 'input', 'link', 'meta', 'source'],
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedSchemesAppliedToAttributes: ['href', 'src', 'srcset'],
    allowProtocolRelative: false,
    transformTags: {
      '*': (tagName, attribs) => {
        const out: sanitizeHtml.Attributes = {};

        const id = attribs.id ? namespaceFragment(attribs.id) : null;
        if (id) out.id = id;

        switch (tagName) {
          case 'a': {
            const raw = attribs.href?.trim() ?? '';
            if (raw.startsWith('#')) {
              const fragment = namespaceFragment(raw);
              if (fragment) out.href = `#${fragment}`;
            } else {
              const href = absolutize(raw, hrefBase);
              if (href) {
                out.href = href;
                // Third-party destinations: no referral weight, no window handle.
                out.rel = 'nofollow noopener ugc';
                out.target = '_blank';
              }
            }
            if (attribs.title) out.title = attribs.title;
            break;
          }
          case 'img': {
            // https-only: an http image would be blocked as mixed content
            // anyway, and silently break the layout it was meant to fill.
            const src = absolutize(attribs.src, srcBase, true);
            if (src) out.src = src;
            out.alt = attribs.alt ?? '';
            out.loading = 'lazy';
            if (attribs.title) out.title = attribs.title;
            const width = keepNumeric(attribs.width);
            if (width) out.width = width;
            const height = keepNumeric(attribs.height);
            if (height) out.height = height;
            const align = keepAlign(attribs.align);
            if (align) out.align = align;
            break;
          }
          case 'source': {
            // <picture> with light/dark variants is common in READMEs.
            const srcset = rewriteSrcset(attribs.srcset, srcBase);
            if (srcset) out.srcset = srcset;
            if (attribs.media) out.media = attribs.media;
            if (attribs.type) out.type = attribs.type;
            if (attribs.sizes) out.sizes = attribs.sizes;
            break;
          }
          case 'input': {
            // Task lists only; anything else is dropped by exclusiveFilter.
            if (attribs.type?.toLowerCase() === 'checkbox') {
              out.type = 'checkbox';
              out.disabled = 'disabled';
              if (attribs.checked !== undefined) out.checked = 'checked';
            }
            break;
          }
          case 'td':
          case 'th': {
            const align = keepAlign(attribs.align);
            if (align) out.align = align;
            const colspan = keepNumeric(attribs.colspan);
            if (colspan) out.colspan = colspan;
            const rowspan = keepNumeric(attribs.rowspan);
            if (rowspan) out.rowspan = rowspan;
            break;
          }
          default: {
            const align = keepAlign(attribs.align);
            if (align) out.align = align;
          }
        }

        return { tagName: HEADING_DEMOTION[tagName] ?? tagName, attribs: out };
      },
    },
    exclusiveFilter: (frame) =>
      (frame.tag === 'img' && frame.attribs.src === undefined) ||
      (frame.tag === 'source' && frame.attribs.srcset === undefined) ||
      (frame.tag === 'input' && frame.attribs.type !== 'checkbox'),
  }).trim();

  if (clean.length === 0) return null;
  if (Buffer.byteLength(clean, 'utf8') > MAX_README_BYTES) return null;
  // A README of nothing but stripped markup (badges-only, images all dropped)
  // publishes as an empty block; treat it as absent instead.
  if (sanitizeHtml(clean, { allowedTags: [], allowedAttributes: {} }).trim().length === 0 &&
      !clean.includes('<img')) {
    return null;
  }
  return clean;
}
