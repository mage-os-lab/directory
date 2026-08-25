import { describe, expect, it } from 'vitest';
import { MAX_README_BYTES, namespaceFragment, sanitizeReadme } from '../src/pipeline/readme.js';

const repo = { owner: 'northware', repo: 'module-order-export' };
const clean = (html: string) => sanitizeReadme(html, repo) ?? '';

describe('sanitizeReadme', () => {
  it('drops scripts, event handlers and javascript: URLs', () => {
    const html = clean(
      '<p>Safe</p><script>alert(1)</script><p onclick="alert(2)">Handler</p>' +
        '<a href="javascript:alert(3)">Click</a><iframe src="https://evil.example/"></iframe>',
    );
    expect(html).toContain('Safe');
    expect(html).toContain('Handler');
    expect(html).not.toContain('alert(1)');
    expect(html).not.toContain('onclick');
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('<iframe');
    // A link whose destination was rejected keeps its text but leads nowhere.
    expect(html).toContain('Click');
    expect(html).not.toMatch(/<a[^>]*href/);
  });

  it('strips the contents of markup-bearing tags, not just the tags', () => {
    const html = clean('<svg><style>body{display:none}</style></svg><p>After</p>');
    expect(html).toBe('<p>After</p>');
  });

  it('absolutizes relative links against the repository', () => {
    const html = clean('<a href="docs/install.md">Install</a>');
    expect(html).toContain(
      'href="https://github.com/northware/module-order-export/blob/HEAD/docs/install.md"',
    );
    expect(html).toContain('rel="nofollow noopener ugc"');
    expect(html).toContain('target="_blank"');
  });

  it('absolutizes relative images against raw.githubusercontent.com', () => {
    const html = clean('<img src="assets/screenshot.png" alt="Screenshot">');
    expect(html).toContain(
      'src="https://raw.githubusercontent.com/northware/module-order-export/HEAD/assets/screenshot.png"',
    );
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('alt="Screenshot"');
  });

  it('leaves absolute URLs alone and drops mixed-content images', () => {
    const html = clean(
      '<a href="https://packagist.org/">Packagist</a><img src="http://insecure.example/b.png">',
    );
    expect(html).toContain('href="https://packagist.org/"');
    expect(html).not.toContain('<img');
  });

  it('rewrites <picture> sources for light/dark screenshots', () => {
    const html = clean(
      '<picture><source media="(prefers-color-scheme: dark)" srcset="dark.png 2x">' +
        '<img src="light.png" alt="UI"></picture>',
    );
    expect(html).toContain(
      'srcset="https://raw.githubusercontent.com/northware/module-order-export/HEAD/dark.png 2x"',
    );
    expect(html).toContain('media="(prefers-color-scheme: dark)"');
  });

  it('namespaces ids and in-page anchors so a README table of contents works', () => {
    const html = clean(
      '<ul><li><a href="#installation">Installation</a></li></ul>' +
        '<h2><a id="user-content-installation" class="anchor" href="#installation"></a>Installation</h2>',
    );
    expect(html).toContain('href="#readme-installation"');
    expect(html).toContain('id="readme-installation"');
    expect(html).not.toContain('user-content-');
    expect(html).not.toContain('class=');
  });

  it('demotes headings so the page keeps a single h1', () => {
    const html = clean('<h1>Order Export</h1><h2>Install</h2><h6>Deep</h6>');
    expect(html).toBe('<h2>Order Export</h2><h3>Install</h3><h6>Deep</h6>');
  });

  it('keeps tables, code blocks and task lists', () => {
    const html = clean(
      '<table><tr><th align="right" colspan="2">Version</th></tr></table>' +
        '<pre><code>composer require northware/module-order-export</code></pre>' +
        '<ul><li><input type="checkbox" checked disabled> Done</li></ul>',
    );
    expect(html).toContain('<th align="right" colspan="2">Version</th>');
    expect(html).toContain('<pre><code>composer require');
    expect(html).toContain('<input type="checkbox" disabled="disabled" checked="checked" />');
  });

  it('drops non-checkbox inputs and unparseable attribute values', () => {
    const html = clean('<input type="text" name="q"><p align="evil">Body</p>');
    expect(html).not.toContain('<input');
    expect(html).toBe('<p>Body</p>');
  });

  it('returns null for empty and oversized READMEs', () => {
    expect(sanitizeReadme('   <!-- nothing here -->  ', repo)).toBeNull();
    expect(sanitizeReadme('<script>alert(1)</script>', repo)).toBeNull();
    const huge = `<p>${'x'.repeat(MAX_README_BYTES + 1)}</p>`;
    expect(sanitizeReadme(huge, repo)).toBeNull();
  });

  it('keeps an image-only README (badge walls are still content)', () => {
    expect(sanitizeReadme('<p><img src="badge.svg" alt=""></p>', repo)).toContain('<img');
  });
});

describe('namespaceFragment', () => {
  it('agrees between percent-encoded hrefs and raw ids', () => {
    expect(namespaceFragment('#%E4%B8%AD%E6%96%87')).toBe(namespaceFragment('user-content-中文'));
  });

  it('rejects fragments with nothing usable left', () => {
    expect(namespaceFragment('#---')).toBeNull();
  });
});
