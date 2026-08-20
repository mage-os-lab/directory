<?php
declare(strict_types=1);

namespace MageOS\ExtensionDirectory\ViewModel;

use MageOS\ExtensionDirectory\Model\ComposerLock\InstalledPackages;
use MageOS\ExtensionDirectory\Model\Config;
use MageOS\ExtensionDirectory\Model\Feed\FeedProvider;
use Magento\Backend\Model\UrlInterface;
use Magento\Framework\App\ProductMetadataInterface;
use Magento\Framework\Serialize\Serializer\Json;
use Magento\Framework\View\Asset\Repository as AssetRepository;
use Magento\Framework\View\Element\Block\ArgumentInterface;

/**
 * Everything the admin template needs to mount the directory bundle.
 */
class DirectoryConfig implements ArgumentInterface
{
    private const BUNDLE_ASSET_ID = 'MageOS_ExtensionDirectory::js/directory-ui.iife.js';
    private const REMOTE_BUNDLE_PATH = '/embed/directory-ui.iife.js';
    private const REMOTE_FEED_PATH = '/api/v1/feed.json';
    private const PROXY_FEED_ROUTE = 'mageos_directory/feed/index';

    /**
     * The catalog is rebuilt daily, so a cached copy only counts as worth mentioning to the
     * merchant once it has outlived a full rebuild cycle.
     */
    private const STALE_AFTER = 86400;

    public function __construct(
        private readonly Config $config,
        private readonly FeedProvider $feedProvider,
        private readonly InstalledPackages $installedPackages,
        private readonly ProductMetadataInterface $productMetadata,
        private readonly UrlInterface $backendUrl,
        private readonly AssetRepository $assetRepository,
        private readonly Json $json
    ) {
    }

    public function isEnabled(): bool
    {
        return $this->config->isEnabled();
    }

    public function getBundleUrl(): string
    {
        if ($this->config->getBundleSource() === Config::BUNDLE_SOURCE_REMOTE) {
            return $this->config->getBaseUrl() . self::REMOTE_BUNDLE_PATH;
        }

        return $this->assetRepository->getUrl(self::BUNDLE_ASSET_ID);
    }

    /**
     * Options for MageOSDirectory.mountDirectory(), ready to embed in the page.
     */
    public function getMountConfigJson(): string
    {
        $mountConfig = [
            'feedUrl' => $this->getFeedUrl(),
            'baseUrl' => $this->config->getBaseUrl(),
            'linkMode' => 'event',
            'selectable' => true,
        ];

        // An empty PHP array serializes to [], but the bundle expects an object here, so the
        // key is left out entirely when the shop has nothing to report.
        $installed = $this->installedPackages->getMap();
        if ($installed !== []) {
            $mountConfig['installed'] = $installed;
        }

        $mountConfig['magentoVersion'] = $this->productMetadata->getVersion();

        // The template embeds this in a <script type="application/json"> block; encoding "<"
        // as \u003C keeps any value from ever closing that block, and it is still plain JSON.
        return str_replace('<', '\\u003C', $this->json->serialize($mountConfig));
    }

    public function getDirectoryBaseUrl(): string
    {
        return $this->config->getBaseUrl();
    }

    /**
     * ISO 8601 timestamp of the cached feed, but only when it is old enough to be worth a notice.
     *
     * Null in direct mode (the browser fetches the feed itself and the bundle reports its own
     * freshness), when nothing is cached yet, and when the cached copy is recent.
     */
    public function getDataAsOf(): ?string
    {
        if ($this->config->getFeedMode() !== Config::FEED_MODE_PROXY) {
            return null;
        }

        try {
            $metadata = $this->feedProvider->peek();
        } catch (\Throwable) {
            // The page is worth rendering even when the cache layer is not cooperating.
            return null;
        }

        if ($metadata === null) {
            return null;
        }

        $fetchedAt = (int)$metadata['fetchedAt'];
        if ($fetchedAt <= 0 || $fetchedAt > time() - self::STALE_AFTER) {
            return null;
        }

        return date('c', $fetchedAt);
    }

    private function getFeedUrl(): string
    {
        if ($this->config->getFeedMode() === Config::FEED_MODE_DIRECT) {
            return $this->config->getBaseUrl() . self::REMOTE_FEED_PATH;
        }

        return $this->backendUrl->getUrl(self::PROXY_FEED_ROUTE);
    }
}
