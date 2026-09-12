<?php
declare(strict_types=1);

namespace MageOS\ExtensionDirectory\Model;

use Magento\Framework\App\Config\ScopeConfigInterface;

/**
 * Typed accessors for the module's settings.
 *
 * Two things are stored in configuration, both in the core Advanced > Admin section rather than
 * a section of their own: the direct/proxy mode, and whether the dashboard carries the panel
 * that points administrators at the directory. The base URL is a constant on purpose: the
 * module ships from the same repository as the directory service, so moving the host is a
 * one-commit change here rather than a value every merchant has to correct.
 *
 * The directory is an admin-global feature, so everything is read in the default scope.
 */
class Config
{
    public const MODE_DIRECT = 'direct';
    public const MODE_PROXY = 'proxy';

    public const XML_PATH_MODE = 'admin/mageos_extension_directory/mode';
    public const XML_PATH_DASHBOARD_CTA = 'admin/dashboard/mageos_extension_directory_tip';

    /**
     * Directory origin, without a trailing slash.
     */
    public const BASE_URL = 'https://rhoerr.github.io/mage-os.directory';

    /**
     * Seconds before the cached feed is revalidated against manifest.json. The catalog is
     * rebuilt once a day, so an hour is plenty.
     */
    public const CACHE_TTL = 3600;

    /**
     * Outbound HTTP timeout in seconds.
     */
    public const HTTP_TIMEOUT = 10;

    public function __construct(
        private readonly ScopeConfigInterface $scopeConfig
    ) {
    }

    /**
     * Anything unrecognised reads as direct, which is also the shipped default.
     */
    public function getMode(): string
    {
        $mode = (string)$this->scopeConfig->getValue(self::XML_PATH_MODE);

        return $mode === self::MODE_PROXY ? self::MODE_PROXY : self::MODE_DIRECT;
    }

    public function isProxy(): bool
    {
        return $this->getMode() === self::MODE_PROXY;
    }

    /**
     * Whether the admin dashboard shows the panel pointing unrestricted administrators at the
     * directory. Shipped on (config.xml); this setting and the panel's own button turn it off.
     */
    public function isDashboardCtaEnabled(): bool
    {
        return $this->scopeConfig->isSetFlag(self::XML_PATH_DASHBOARD_CTA);
    }

    public function getBaseUrl(): string
    {
        return self::BASE_URL;
    }

    public function getCacheTtl(): int
    {
        return self::CACHE_TTL;
    }

    public function getHttpTimeout(): int
    {
        return self::HTTP_TIMEOUT;
    }
}
