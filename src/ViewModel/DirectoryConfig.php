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

    /**
     * A Magento release line, with the optional patch suffix Adobe appends (2.4.9, 2.4.8-p5).
     */
    private const RELEASE_PATTERN = '/^\d+\.\d+\.\d+(-p\d+)?$/';

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

    public function getBundleUrl(): string
    {
        if ($this->config->isProxy()) {
            return $this->assetRepository->getUrl(self::BUNDLE_ASSET_ID);
        }

        return $this->config->getBaseUrl() . self::REMOTE_BUNDLE_PATH;
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
            // Both admin themes are light-only; the bundle must not follow the OS into dark.
            'colorScheme' => 'light',
        ];

        // An empty PHP array serializes to [], but the bundle expects an object here, so the
        // key is left out entirely when the shop has nothing to report.
        $installed = $this->installedPackages->getMap();
        if ($installed !== []) {
            $mountConfig['installed'] = $installed;
        }

        $magentoVersion = $this->getMagentoVersion();
        if ($magentoVersion !== null) {
            $mountConfig['magentoVersion'] = $magentoVersion;

            $distribution = $this->getDistribution();
            if ($distribution !== null) {
                $mountConfig['distribution'] = $distribution;
            }
        }

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
        if (!$this->config->isProxy()) {
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

    /**
     * The Magento release the shop runs, or null when it cannot be trusted.
     *
     * On Mage-OS getVersion() already answers with the Magento-equivalent release, which is
     * exactly what the bundle wants. On a git or source install there is no metapackage to read
     * it from, so it degrades to the root composer version ("1.0.0+no-version-set", "UNKNOWN");
     * sending that would have every card claim it was not tested with it, so the key is dropped.
     */
    private function getMagentoVersion(): ?string
    {
        $version = (string)$this->productMetadata->getVersion();

        return preg_match(self::RELEASE_PATTERN, $version) === 1 ? $version : null;
    }

    /**
     * The distribution running the shop, for hosts that are not plain Magento.
     *
     * An admin on Mage-OS 3.5 has no idea what "Tested with 2.4.9" is telling them, so the
     * bundle is handed the distribution's own name and number to label with. Only Mage-OS's
     * concrete ProductMetadata carries these two methods - they are not on the interface, and
     * DI may hand us an interceptor subclass - so the instance is asked rather than the type.
     *
     * @return array{name: string, version: string}|null
     */
    private function getDistribution(): ?array
    {
        if (
            !method_exists($this->productMetadata, 'getDistributionName')
            || !method_exists($this->productMetadata, 'getDistributionVersion')
        ) {
            return null;
        }

        $name = trim((string)$this->productMetadata->getDistributionName());
        $version = trim((string)$this->productMetadata->getDistributionVersion());

        if ($name === '' || $name === 'Magento' || preg_match(self::RELEASE_PATTERN, $version) !== 1) {
            return null;
        }

        return ['name' => $name, 'version' => $version];
    }

    private function getFeedUrl(): string
    {
        if ($this->config->isProxy()) {
            return $this->backendUrl->getUrl(self::PROXY_FEED_ROUTE);
        }

        return $this->config->getBaseUrl() . self::REMOTE_FEED_PATH;
    }
}
