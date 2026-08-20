<?php
declare(strict_types=1);

namespace MageOS\ExtensionDirectory\Model;

use Magento\Framework\App\Config\ScopeConfigInterface;

/**
 * Typed accessors for mageos_extension_directory/general/*.
 *
 * The directory is an admin-global feature, so every value is read in the default scope.
 */
class Config
{
    public const XML_PATH_ENABLED = 'mageos_extension_directory/general/enabled';
    public const XML_PATH_BASE_URL = 'mageos_extension_directory/general/base_url';
    public const XML_PATH_FEED_MODE = 'mageos_extension_directory/general/feed_mode';
    public const XML_PATH_BUNDLE_SOURCE = 'mageos_extension_directory/general/bundle_source';
    public const XML_PATH_CACHE_TTL = 'mageos_extension_directory/general/cache_ttl';
    public const XML_PATH_HTTP_TIMEOUT = 'mageos_extension_directory/general/http_timeout';

    public const FEED_MODE_PROXY = 'proxy';
    public const FEED_MODE_DIRECT = 'direct';

    public const BUNDLE_SOURCE_BUNDLED = 'bundled';
    public const BUNDLE_SOURCE_REMOTE = 'remote';

    private const DEFAULT_CACHE_TTL = 3600;
    private const MIN_CACHE_TTL = 60;
    private const DEFAULT_HTTP_TIMEOUT = 10;
    private const MIN_HTTP_TIMEOUT = 1;

    public function __construct(
        private readonly ScopeConfigInterface $scopeConfig
    ) {
    }

    public function isEnabled(): bool
    {
        return $this->scopeConfig->isSetFlag(self::XML_PATH_ENABLED);
    }

    /**
     * Directory origin without a trailing slash, e.g. https://example.com/directory
     */
    public function getBaseUrl(): string
    {
        return rtrim(trim((string)$this->scopeConfig->getValue(self::XML_PATH_BASE_URL)), '/');
    }

    public function getFeedMode(): string
    {
        $mode = (string)$this->scopeConfig->getValue(self::XML_PATH_FEED_MODE);

        return $mode === self::FEED_MODE_DIRECT ? self::FEED_MODE_DIRECT : self::FEED_MODE_PROXY;
    }

    public function getBundleSource(): string
    {
        $source = (string)$this->scopeConfig->getValue(self::XML_PATH_BUNDLE_SOURCE);

        return $source === self::BUNDLE_SOURCE_REMOTE ? self::BUNDLE_SOURCE_REMOTE : self::BUNDLE_SOURCE_BUNDLED;
    }

    /**
     * Seconds before the cached feed is revalidated against manifest.json.
     */
    public function getCacheTtl(): int
    {
        $ttl = (int)$this->scopeConfig->getValue(self::XML_PATH_CACHE_TTL);
        if ($ttl <= 0) {
            $ttl = self::DEFAULT_CACHE_TTL;
        }

        return max(self::MIN_CACHE_TTL, $ttl);
    }

    /**
     * Outbound HTTP timeout in seconds.
     */
    public function getHttpTimeout(): int
    {
        $timeout = (int)$this->scopeConfig->getValue(self::XML_PATH_HTTP_TIMEOUT);
        if ($timeout <= 0) {
            $timeout = self::DEFAULT_HTTP_TIMEOUT;
        }

        return max(self::MIN_HTTP_TIMEOUT, $timeout);
    }
}
