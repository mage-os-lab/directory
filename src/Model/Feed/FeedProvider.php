<?php
declare(strict_types=1);

namespace MageOS\ExtensionDirectory\Model\Feed;

use MageOS\ExtensionDirectory\Model\Cache\Type as DirectoryCache;
use MageOS\ExtensionDirectory\Model\Config;
use Magento\Framework\HTTP\ClientFactory;
use Psr\Log\LoggerInterface;

/**
 * Serves the directory feed from Magento's cache, revalidating against the upstream manifest.
 */
class FeedProvider
{
    private const BODY_CACHE_ID = 'mageos_extdir_feed_body';
    private const META_CACHE_ID = 'mageos_extdir_feed_meta';

    /**
     * Entries are kept for a year on purpose: freshness is decided from the stored fetchedAt
     * against the configured TTL, not from cache expiry, so a copy that is past the TTL is
     * still on hand as the stale fallback when upstream is unreachable.
     */
    private const CACHE_LIFETIME = 31536000;

    private const SCHEMA_VERSION = 1;

    private const MANIFEST_PATH = '/api/v1/manifest.json';
    private const FEED_PATH = '/api/v1/feed.json';

    public function __construct(
        private readonly Config $config,
        private readonly DirectoryCache $cache,
        private readonly ClientFactory $httpClientFactory,
        private readonly LoggerInterface $logger
    ) {
    }

    /**
     * @throws FeedUnavailableException
     */
    public function get(): FeedResult
    {
        $cached = $this->loadCached();

        if ($cached !== null && (time() - $cached['meta']['fetchedAt']) < $this->config->getCacheTtl()) {
            return new FeedResult($cached['body'], $cached['meta']['fetchedAt'], false);
        }

        // With a cached copy in hand the ~200 byte manifest decides whether the ~1.7 MB feed has
        // to be refetched at all — that is what its feedHash exists for. A cold cache skips
        // straight to the feed instead of paying for a round-trip it cannot use.
        if ($cached !== null) {
            $manifestHash = $this->fetchManifestHash();
            if ($manifestHash !== null && $manifestHash === $cached['meta']['feedHash']) {
                $fetchedAt = time();
                $this->saveMeta($fetchedAt, $cached['meta']['feedHash']);

                return new FeedResult($cached['body'], $fetchedAt, false);
            }
        }

        $body = $this->fetchFeed();
        if ($body !== null) {
            $fetchedAt = time();
            $this->cache->save($body, self::BODY_CACHE_ID, [DirectoryCache::CACHE_TAG], self::CACHE_LIFETIME);
            $this->saveMeta($fetchedAt, hash('sha256', $body));

            return new FeedResult($body, $fetchedAt, false);
        }

        if ($cached !== null) {
            $this->logger->warning(
                'Mage-OS Extension Directory: refreshing the feed failed, serving the cached copy as stale.'
            );

            return new FeedResult($cached['body'], $cached['meta']['fetchedAt'], true);
        }

        throw new FeedUnavailableException(
            __('The extension directory feed is unavailable and no cached copy exists yet.')
        );
    }

    /**
     * Cached feed metadata without any network I/O.
     *
     * @return array{fetchedAt: int, feedHash: string}|null
     */
    public function peek(): ?array
    {
        return $this->loadMeta();
    }

    /**
     * @return array{body: string, meta: array{fetchedAt: int, feedHash: string}}|null
     */
    private function loadCached(): ?array
    {
        $meta = $this->loadMeta();
        if ($meta === null) {
            return null;
        }

        $body = $this->cache->load(self::BODY_CACHE_ID);
        if (!is_string($body) || $body === '') {
            return null;
        }

        return ['body' => $body, 'meta' => $meta];
    }

    /**
     * @return array{fetchedAt: int, feedHash: string}|null
     */
    private function loadMeta(): ?array
    {
        $raw = $this->cache->load(self::META_CACHE_ID);
        if (!is_string($raw) || $raw === '') {
            return null;
        }

        $meta = json_decode($raw, true);
        if (!is_array($meta) || !isset($meta['fetchedAt'], $meta['feedHash'])) {
            return null;
        }

        return ['fetchedAt' => (int)$meta['fetchedAt'], 'feedHash' => (string)$meta['feedHash']];
    }

    private function saveMeta(int $fetchedAt, string $feedHash): void
    {
        $this->cache->save(
            (string)json_encode(['fetchedAt' => $fetchedAt, 'feedHash' => $feedHash]),
            self::META_CACHE_ID,
            [DirectoryCache::CACHE_TAG],
            self::CACHE_LIFETIME
        );
    }

    /**
     * @return string|null SHA-256 of the upstream feed, or null when the manifest is unusable
     */
    private function fetchManifestHash(): ?string
    {
        $body = $this->request($this->config->getBaseUrl() . self::MANIFEST_PATH);
        if ($body === null) {
            return null;
        }

        $manifest = json_decode($body, true);
        $feedHash = is_array($manifest) ? ($manifest['feedHash'] ?? null) : null;
        if (!is_array($manifest)
            || ($manifest['schemaVersion'] ?? null) !== self::SCHEMA_VERSION
            || !is_string($feedHash)
            || $feedHash === ''
        ) {
            $this->logger->warning('Mage-OS Extension Directory: manifest.json is not a usable schemaVersion 1 manifest.');

            return null;
        }

        return $feedHash;
    }

    /**
     * @return string|null The raw feed JSON, or null when the fetch or the payload is unusable
     */
    private function fetchFeed(): ?string
    {
        $body = $this->request($this->config->getBaseUrl() . self::FEED_PATH);
        if ($body === null) {
            return null;
        }

        // A feed announcing a newer schema counts as a failed fetch: the bundled UI only knows
        // schemaVersion 1, so the last good cached copy is preferable to misrendering a v2 feed.
        $decoded = json_decode($body, true);
        if (!is_array($decoded) || ($decoded['schemaVersion'] ?? null) !== self::SCHEMA_VERSION) {
            $this->logger->warning('Mage-OS Extension Directory: feed.json is not a usable schemaVersion 1 feed.');

            return null;
        }

        return $body;
    }

    private function request(string $url): ?string
    {
        try {
            // The curl client keeps per-request state, so a fresh one is created for every call.
            $client = $this->httpClientFactory->create();
            $client->setTimeout($this->config->getHttpTimeout());
            $client->get($url);

            $status = $client->getStatus();
            if ($status !== 200) {
                $this->logger->warning(
                    sprintf('Mage-OS Extension Directory: %s responded with HTTP %d.', $url, $status)
                );

                return null;
            }

            $body = (string)$client->getBody();
            if ($body === '') {
                $this->logger->warning(sprintf('Mage-OS Extension Directory: %s returned an empty body.', $url));

                return null;
            }

            return $body;
        } catch (\Throwable $e) {
            $this->logger->warning(
                sprintf('Mage-OS Extension Directory: requesting %s failed: %s', $url, $e->getMessage())
            );

            return null;
        }
    }
}
