import { describe, expect, it } from 'vitest';
import { httpUrl } from '../src/schema/common.js';
import { vendorFile } from '../src/schema/vendor-file.js';

describe('httpUrl', () => {
  it('accepts http and https links', () => {
    expect(httpUrl.safeParse('https://github.com/acme/module-widget').success).toBe(true);
    expect(httpUrl.safeParse('http://example.com/docs').success).toBe(true);
  });

  it.each([
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
  ])('rejects %s', (url) => {
    expect(httpUrl.safeParse(url).success).toBe(false);
  });

  it('holds for vendor-file links too', () => {
    const parsed = vendorFile.safeParse({
      vendor: 'acme',
      vendorName: 'Acme',
      url: 'javascript:alert(1)',
    });
    expect(parsed.success).toBe(false);
  });
});
