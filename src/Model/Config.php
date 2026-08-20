<?php
declare(strict_types=1);

namespace MageOS\ExtensionDirectory\Model;

use Magento\Framework\App\Config\ScopeConfigInterface;

/**
 * Typed accessors for the module's settings.
 *
 * Only the direct/proxy mode is stored in configuration; the base URL is a constant on purpose.
 * The module ships from the same repository as the directory service, so moving the host is a
 * one-commit change here rather than a value every merchant has to correct, and the mode toggle
 * stays the only knob a merchant needs.
 *
 * The directory is an admin-global feature, so the mode is read in the default scope.
 */
class Config
{
    public const MODE_DIRECT = 'direct';
    public const MODE_PROXY = 'proxy';

    public const XML_PATH_MODE = 'mageos_extension_directory/general/mode';

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
