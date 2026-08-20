<?php
declare(strict_types=1);

namespace MageOS\ExtensionDirectory\Model\ComposerLock;

use MageOS\ExtensionDirectory\Model\Cache\Type as DirectoryCache;
use Magento\Framework\App\Filesystem\DirectoryList;
use Magento\Framework\Filesystem;
use Psr\Log\LoggerInterface;

/**
 * Composer name => installed version, read from the Magento root composer.lock.
 */
class InstalledPackages
{
    private const LOCK_FILE = 'composer.lock';
    private const CACHE_ID_PREFIX = 'mageos_extdir_installed_';
    private const CACHE_LIFETIME = 86400;

    public function __construct(
        private readonly Filesystem $filesystem,
        private readonly DirectoryCache $cache,
        private readonly LoggerInterface $logger
    ) {
    }

    /**
     * @return array<string, string>
     */
    public function getMap(): array
    {
        try {
            $directory = $this->filesystem->getDirectoryRead(DirectoryList::ROOT);
            if (!$directory->isFile(self::LOCK_FILE)) {
                $this->logger->debug('Mage-OS Extension Directory: no composer.lock in the Magento root.');

                return [];
            }

            $stat = $directory->stat(self::LOCK_FILE);
            $cacheId = self::CACHE_ID_PREFIX
                . sha1(((string)($stat['mtime'] ?? '')) . ':' . ((string)($stat['size'] ?? '')));

            $cached = $this->cache->load($cacheId);
            if (is_string($cached) && $cached !== '') {
                $map = json_decode($cached, true);
                if (is_array($map)) {
                    return $map;
                }
            }

            $map = $this->parse($directory->readFile(self::LOCK_FILE));
            $this->cache->save(
                (string)json_encode($map),
                $cacheId,
                [DirectoryCache::CACHE_TAG],
                self::CACHE_LIFETIME
            );

            return $map;
        } catch (\Throwable $e) {
            // The installed map only enriches the listing; the admin page has to render without it.
            $this->logger->debug('Mage-OS Extension Directory: composer.lock could not be read: ' . $e->getMessage());

            return [];
        }
    }

    /**
     * @return array<string, string>
     */
    private function parse(string $contents): array
    {
        $data = json_decode($contents, true);
        if (!is_array($data)) {
            $this->logger->debug('Mage-OS Extension Directory: composer.lock is not valid JSON.');

            return [];
        }

        $map = [];
        // packages-dev is left out deliberately: dev requirements are not part of the shop's
        // installed extension set.
        foreach ($data['packages'] ?? [] as $package) {
            $name = is_array($package) ? ($package['name'] ?? null) : null;
            $version = is_array($package) ? ($package['version'] ?? null) : null;
            if (!is_string($name) || $name === '' || !is_string($version) || $version === '') {
                continue;
            }

            $map[$name] = (string)preg_replace('/^v/i', '', $version);
        }

        return $map;
    }
}
