/**
 * Categories are PackageMaven's: its slugs, its names. The directory adds two
 * rules on top. "Miscellaneous" is PM's catch-all, so a package that also has
 * a real category is not listed under it. And the slugs the directory used
 * before it adopted PM's taxonomy still resolve, so old shared links
 * (`?category=seo`, `/categories/seo/`) land on the matching PM category.
 */

/** PM's catch-all category. */
export const MISCELLANEOUS = 'miscellaneous';

/** The directory's own category slugs, before PM's, mapped to PM's. */
export const LEGACY_CATEGORY_SLUGS: Readonly<Record<string, string>> = {
  'admin-tools': 'administration-backend',
  catalog: 'catalog-management',
  checkout: 'checkout-payments',
  content: 'content-management',
  customer: 'customer-authentication',
  integration: 'integration-third-party',
  marketing: 'email-communication',
  other: MISCELLANEOUS,
  payments: 'checkout-payments',
  performance: 'performance-optimization',
  reporting: 'analytics-tracking',
  security: 'security-compliance',
  seo: 'seo-urls',
  shipping: 'order-shipping',
};

/** The current slug for a category slug, following a legacy alias. */
export function resolveCategorySlug(slug: string): string {
  return Object.hasOwn(LEGACY_CATEGORY_SLUGS, slug) ? LEGACY_CATEGORY_SLUGS[slug]! : slug;
}

/**
 * A package's categories from PM's slugs: trimmed, lowercased, deduplicated
 * and sorted, with Miscellaneous dropped when anything else is left.
 */
export function packageCategories(slugs: readonly string[]): string[] {
  const unique = [...new Set(slugs.map((s) => s.trim().toLowerCase()).filter((s) => s !== ''))];
  const specific = unique.filter((s) => s !== MISCELLANEOUS);
  return (specific.length > 0 ? specific : unique).sort();
}

/** A readable name for a slug PM did not name: "seo-urls" → "Seo Urls". */
export function categoryNameFromSlug(slug: string): string {
  return slug
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
