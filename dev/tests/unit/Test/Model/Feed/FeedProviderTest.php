<?php
declare(strict_types=1);

namespace MageOS\ExtensionDirectory\Test\Unit\Model\Feed;

use MageOS\ExtensionDirectory\Model\Cache\Type as DirectoryCache;
use MageOS\ExtensionDirectory\Model\Config;
use MageOS\ExtensionDirectory\Model\Feed\FeedProvider;
use MageOS\ExtensionDirectory\Model\Feed\FeedUnavailableException;
use MageOS\ExtensionDirectory\Test\Unit\Fake\ArrayScopeConfig;
use MageOS\ExtensionDirectory\Test\Unit\Fake\CollectingLogger;
use MageOS\ExtensionDirectory\Test\Unit\Fake\InMemoryCache;
use MageOS\ExtensionDirectory\Test\Unit\Fake\ScriptedHttpClientFactory;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

final class FeedProviderTest extends TestCase
{
    private const MANIFEST_URL = Config::BASE_URL . '/api/v1/manifest.json';
    private const FEED_URL = Config::BASE_URL . '/api/v1/feed.json';

    private const UNRELATED_HASH = 'd0d0cafed0d0cafed0d0cafed0d0cafed0d0cafed0d0cafed0d0cafed0d0cafe';

    private const STALE_WARNING =
        'Mage-OS Extension Directory: refreshing the feed failed, serving the cached copy as stale.';

    private ScriptedHttpClientFactory $http;

    private InMemoryCache $cache;

    private CollectingLogger $logger;

    protected function setUp(): void
    {
        $this->http = new ScriptedHttpClientFactory();
        $this->cache = new InMemoryCache();
        $this->logger = new CollectingLogger();
    }

    public function testAFreshCachedCopyIsServedWithoutTouchingTheNetwork(): void
    {
        $body = $this->feed();
        $provider = $this->provider();
        $this->http->respondWith(self::FEED_URL, 200, $body);
        $seeded = $provider->get();
        $this->http->forgetRequests();

        $result = $provider->get();

        self::assertSame([], $this->http->getRequestedUrls());
        self::assertSame($body, $result->getBody());
        self::assertFalse($result->isStale());
        self::assertSame($seeded->getFetchedAt(), $result->getFetchedAt());
    }

    public function testAnExpiredCopyWhoseHashStillMatchesCostsOnlyTheManifestRequest(): void
    {
        $body = $this->feed();
        $provider = $this->provider();
        $this->http->respondWith(self::FEED_URL, 200, $body);
        $provider->get();

        $this->cache->ageBy(7200);
        $this->http->forgetRequests();
        $this->http->respondWith(self::MANIFEST_URL, 200, $this->manifest(hash('sha256', $body)));

        $revalidatedAfter = time();
        $result = $provider->get();

        self::assertSame([self::MANIFEST_URL], $this->http->getRequestedUrls());
        self::assertSame($body, $result->getBody());
        self::assertFalse($result->isStale());
        self::assertGreaterThanOrEqual($revalidatedAfter, $result->getFetchedAt());

        // The revalidation bumped fetchedAt, so the copy counts as fresh again.
        $this->http->forgetRequests();
        $provider->get();
        self::assertSame([], $this->http->getRequestedUrls());
    }

    public function testAChangedHashRefetchesTheFeedAndStoresTheNewCopy(): void
    {
        $first = $this->feed('first');
        $second = $this->feed('second');
        $provider = $this->provider();
        $this->http->respondWith(self::FEED_URL, 200, $first);
        $provider->get();

        $this->cache->ageBy(7200);
        $this->http->forgetRequests();
        $this->http->respondWith(self::MANIFEST_URL, 200, $this->manifest(hash('sha256', $second)));
        $this->http->respondWith(self::FEED_URL, 200, $second);

        $result = $provider->get();

        self::assertSame([self::MANIFEST_URL, self::FEED_URL], $this->http->getRequestedUrls());
        self::assertSame($second, $result->getBody());
        self::assertFalse($result->isStale());

        // The new copy is what the next caller gets, without another round-trip.
        $this->http->forgetRequests();
        self::assertSame($second, $provider->get()->getBody());
        self::assertSame([], $this->http->getRequestedUrls());

        $metadata = $provider->peek();
        self::assertIsArray($metadata);
        self::assertSame(hash('sha256', $second), $metadata['feedHash']);
    }

    public function testAColdCacheGoesStraightToTheFeedAndSkipsTheManifest(): void
    {
        $body = $this->feed();
        $this->http->respondWith(self::FEED_URL, 200, $body);
        $this->http->respondWith(self::MANIFEST_URL, 200, $this->manifest(hash('sha256', $body)));

        $result = $this->provider()->get();

        self::assertSame([self::FEED_URL], $this->http->getRequestedUrls());
        self::assertSame($body, $result->getBody());
        self::assertFalse($result->isStale());
    }

    public function testAnUnusableManifestFallsThroughToRefetchingTheFeed(): void
    {
        $first = $this->feed('first');
        $second = $this->feed('second');
        $provider = $this->provider();
        $this->http->respondWith(self::FEED_URL, 200, $first);
        $provider->get();

        $this->cache->ageBy(7200);
        $this->http->forgetRequests();
        $this->http->respondWith(
            self::MANIFEST_URL,
            200,
            (string)json_encode(['schemaVersion' => 2, 'feedHash' => hash('sha256', $first)])
        );
        $this->http->respondWith(self::FEED_URL, 200, $second);

        $result = $provider->get();

        self::assertSame([self::MANIFEST_URL, self::FEED_URL], $this->http->getRequestedUrls());
        self::assertSame($second, $result->getBody());
        self::assertContains(
            'Mage-OS Extension Directory: manifest.json is not a usable schemaVersion 1 manifest.',
            $this->logger->getMessages('warning')
        );
    }

    #[DataProvider('upstreamFailureProvider')]
    public function testAnExpiredCopyIsServedAsStaleWhenTheRefreshFails(string $failure): void
    {
        $body = $this->feed();
        $provider = $this->provider();
        $this->http->respondWith(self::FEED_URL, 200, $body);
        $seededAt = $provider->get()->getFetchedAt();

        $this->cache->ageBy(7200);
        $this->http->forgetRequests();
        $this->scriptFailure($failure);

        $result = $provider->get();

        self::assertTrue($result->isStale());
        self::assertSame($body, $result->getBody());
        self::assertSame($seededAt - 7200, $result->getFetchedAt());
        self::assertNotSame([], $this->http->getRequestedUrls());
        self::assertContains(self::STALE_WARNING, $this->logger->getMessages('warning'));
    }

    #[DataProvider('upstreamFailureProvider')]
    public function testAColdCacheAndAFailedFetchThrowsAndStoresNothing(string $failure): void
    {
        $this->scriptFailure($failure);
        $provider = $this->provider();

        try {
            $provider->get();
            self::fail('Expected a FeedUnavailableException when nothing is cached.');
        } catch (FeedUnavailableException $exception) {
            self::assertSame(
                'The extension directory feed is unavailable and no cached copy exists yet.',
                $exception->getMessage()
            );
        }

        self::assertTrue($this->cache->isEmpty(), 'A failed fetch must not leave anything in the cache.');
        self::assertSame([self::FEED_URL], $this->http->getRequestedUrls(), 'A cold cache skips the manifest.');
        self::assertNull($provider->peek());
        self::assertNotContains(self::STALE_WARNING, $this->logger->getMessages('warning'));
    }

    public static function upstreamFailureProvider(): array
    {
        return [
            'the transport throws' => ['throws'],
            'the host answers 500' => ['http-500'],
            'the body is not json' => ['not-json'],
            'the feed announces schemaVersion 2' => ['schema-2'],
            'the body is empty' => ['empty-body'],
        ];
    }

    public function testASchemaVersion2FeedIsNeverServedFromAColdCache(): void
    {
        $this->http->respondWith(
            self::FEED_URL,
            200,
            (string)json_encode(['schemaVersion' => 2, 'packages' => [['name' => 'acme/module-new']]])
        );
        $provider = $this->provider();

        try {
            $provider->get();
            self::fail('Expected a FeedUnavailableException for a schemaVersion 2 feed.');
        } catch (FeedUnavailableException) {
            // The assertions that matter are below.
        }

        self::assertTrue($this->cache->isEmpty());
        self::assertContains(
            'Mage-OS Extension Directory: feed.json is not a usable schemaVersion 1 feed.',
            $this->logger->getMessages('warning')
        );
    }

    public function testAnEmptyTwoHundredCountsAsAFailedFetch(): void
    {
        $this->http->respondWith(self::FEED_URL, 200, '');

        try {
            $this->provider()->get();
            self::fail('Expected a FeedUnavailableException for an empty body.');
        } catch (FeedUnavailableException) {
            // The assertions that matter are below.
        }

        self::assertTrue($this->cache->isEmpty());
        self::assertContains(
            'Mage-OS Extension Directory: ' . self::FEED_URL . ' returned an empty body.',
            $this->logger->getMessages('warning')
        );
    }

    public function testPeekReportsNothingUntilAFeedIsStoredAndNeverMakesARequest(): void
    {
        $provider = $this->provider();

        self::assertNull($provider->peek());
        self::assertSame([], $this->http->getRequestedUrls());

        $body = $this->feed();
        $this->http->respondWith(self::FEED_URL, 200, $body);
        $stored = $provider->get();
        $this->http->forgetRequests();

        $metadata = $provider->peek();

        self::assertIsArray($metadata);
        self::assertSame(['fetchedAt', 'feedHash'], array_keys($metadata));
        self::assertSame($stored->getFetchedAt(), $metadata['fetchedAt']);
        self::assertSame(hash('sha256', $body), $metadata['feedHash']);
        self::assertSame([], $this->http->getRequestedUrls());
    }

    public function testTheHttpTimeoutIsAppliedToEveryRequest(): void
    {
        $body = $this->feed();
        $provider = $this->provider();
        $this->http->respondWith(self::FEED_URL, 200, $body);
        $provider->get();

        $this->cache->ageBy(7200);
        $this->http->respondWith(self::MANIFEST_URL, 200, $this->manifest(hash('sha256', $body)));
        $provider->get();

        self::assertSame([Config::HTTP_TIMEOUT, Config::HTTP_TIMEOUT], $this->http->getTimeouts());
    }

    public function testStoredEntriesCarryTheModuleTagAndOutliveTheFreshnessWindow(): void
    {
        $this->http->respondWith(self::FEED_URL, 200, $this->feed());
        $this->provider()->get();

        $writes = $this->cache->getWrites();

        self::assertCount(2, $writes, 'The body and its metadata are stored separately.');
        foreach ($writes as $write) {
            self::assertSame([DirectoryCache::CACHE_TAG], $write['tags']);
            self::assertGreaterThan(Config::CACHE_TTL, $write['lifetime'], 'A stale copy has to outlive the TTL.');
        }
    }

    public function testTheTtlDecidesWhenARevalidationHappens(): void
    {
        $body = $this->feed();
        $provider = $this->provider();
        $this->http->respondWith(self::FEED_URL, 200, $body);
        $provider->get();
        $this->http->respondWith(self::MANIFEST_URL, 200, $this->manifest(hash('sha256', $body)));

        $this->cache->ageBy(Config::CACHE_TTL - 60);
        $this->http->forgetRequests();
        $provider->get();
        self::assertSame([], $this->http->getRequestedUrls(), 'Inside the TTL nothing is requested.');

        $this->cache->ageBy(120);
        $this->http->forgetRequests();
        $provider->get();
        self::assertSame([self::MANIFEST_URL], $this->http->getRequestedUrls(), 'Past the TTL it revalidates.');
    }

    private function scriptFailure(string $failure): void
    {
        // Except for the transport failure, the manifest answers with a hash nobody has, so the
        // feed request is reached and the failure being exercised is the feed's own.
        switch ($failure) {
            case 'throws':
                $error = new \RuntimeException('cURL error 7: Failed to connect');
                $this->http->failWith(self::MANIFEST_URL, $error);
                $this->http->failWith(self::FEED_URL, $error);

                return;
            case 'http-500':
                $this->http->respondWith(self::MANIFEST_URL, 500, 'upstream is unwell');
                $this->http->respondWith(self::FEED_URL, 500, 'upstream is unwell');

                return;
            case 'not-json':
                $this->http->respondWith(self::MANIFEST_URL, 200, $this->manifest(self::UNRELATED_HASH));
                $this->http->respondWith(self::FEED_URL, 200, '<html><body>Down for maintenance</body></html>');

                return;
            case 'schema-2':
                $this->http->respondWith(self::MANIFEST_URL, 200, $this->manifest(self::UNRELATED_HASH));
                $this->http->respondWith(
                    self::FEED_URL,
                    200,
                    (string)json_encode(['schemaVersion' => 2, 'packages' => []])
                );

                return;
            case 'empty-body':
                $this->http->respondWith(self::MANIFEST_URL, 200, $this->manifest(self::UNRELATED_HASH));
                $this->http->respondWith(self::FEED_URL, 200, '');

                return;
            default:
                throw new \LogicException(sprintf('Unknown failure mode "%s".', $failure));
        }
    }

    private function provider(): FeedProvider
    {
        $config = new Config(new ArrayScopeConfig());

        return new FeedProvider($config, $this->cache, $this->http, $this->logger);
    }

    private function feed(string $marker = 'first'): string
    {
        return (string)json_encode([
            'schemaVersion' => 1,
            'generatedAt' => '2026-08-19T05:23:11Z',
            'packages' => [
                ['name' => 'acme/module-checkout', 'latestVersion' => '2.1.0', 'marker' => $marker],
            ],
        ]);
    }

    private function manifest(string $feedHash): string
    {
        return (string)json_encode([
            'schemaVersion' => 1,
            'generatedAt' => '2026-08-19T05:23:11Z',
            'feedHash' => $feedHash,
        ]);
    }
}
