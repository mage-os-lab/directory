<?php
declare(strict_types=1);

namespace MageOS\ExtensionDirectory\Test\Unit\Controller\Adminhtml;

use MageOS\ExtensionDirectory\Controller\Adminhtml\Feed\Index as FeedController;
use MageOS\ExtensionDirectory\Model\Config;
use MageOS\ExtensionDirectory\Model\Feed\FeedResult;
use MageOS\ExtensionDirectory\Model\Feed\FeedUnavailableException;
use MageOS\ExtensionDirectory\Test\Unit\Fake\ArrayScopeConfig;
use MageOS\ExtensionDirectory\Test\Unit\Fake\FakeFeedProvider;
use MageOS\ExtensionDirectory\Test\Unit\Fake\FakeResultFactory;
use MageOS\ExtensionDirectory\Test\Unit\Fake\RecordingRaw;
use Magento\Backend\App\Action\Context;
use Magento\Framework\Controller\ResultFactory;
use PHPUnit\Framework\TestCase;

final class FeedControllerTest extends TestCase
{
    private const DATA_AS_OF_HEADER = 'X-MageOS-Directory-Data-As-Of';
    private const STALE_HEADER = 'X-MageOS-Directory-Stale';

    private FakeResultFactory $resultFactory;

    private FakeFeedProvider $feedProvider;

    protected function setUp(): void
    {
        $this->resultFactory = new FakeResultFactory();
        $this->feedProvider = new FakeFeedProvider();
    }

    public function testTheProxyAlwaysAnswersAsUncacheableJson(): void
    {
        $this->feedProvider->willReturn(new FeedResult('{"schemaVersion":1}', 1755648000, false));

        $raw = $this->execute(true);

        self::assertSame('application/json', $raw->getHeader('Content-Type'));
        self::assertSame('private, max-age=0, no-store', $raw->getHeader('Cache-Control'));
        self::assertTrue($raw->isHeaderReplacing('Content-Type'));
        self::assertTrue($raw->isHeaderReplacing('Cache-Control'));
        self::assertSame([ResultFactory::TYPE_RAW], $this->resultFactory->getRequestedTypes());
    }

    public function testADisabledModuleAnswersWithAJsonErrorAndNeverAsksForTheFeed(): void
    {
        $raw = $this->execute(false);

        self::assertSame(503, $raw->getHttpResponseCode());
        self::assertSame('application/json', $raw->getHeader('Content-Type'));
        self::assertSame('private, max-age=0, no-store', $raw->getHeader('Cache-Control'));
        self::assertSame(['error' => 'The extension directory is disabled.'], $raw->getDecodedBody());
        self::assertSame(0, $this->feedProvider->getGetCalls());
        self::assertNull($raw->getHeader(self::DATA_AS_OF_HEADER));
        self::assertNull($raw->getHeader(self::STALE_HEADER));
    }

    public function testAFreshFeedIsPassedThroughByteForByteWithAnAsOfHeader(): void
    {
        $body = '{"schemaVersion":1,"packages":[{"name":"acme/module-checkout"}]}';
        $this->feedProvider->willReturn(new FeedResult($body, 1755648000, false));

        $raw = $this->execute(true);

        self::assertSame(200, $raw->getHttpResponseCode());
        self::assertSame($body, $raw->getBody());
        self::assertSame('2025-08-20T00:00:00+00:00', $raw->getHeader(self::DATA_AS_OF_HEADER));
        self::assertNull($raw->getHeader(self::STALE_HEADER), 'A fresh feed carries no staleness signal.');
    }

    public function testTheAsOfHeaderIsAnRfc3339TimestampInUtc(): void
    {
        $fetchedAt = time();
        $this->feedProvider->willReturn(new FeedResult('{"schemaVersion":1}', $fetchedAt, false));

        $header = (string)$this->execute(true)->getHeader(self::DATA_AS_OF_HEADER);

        self::assertMatchesRegularExpression('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+00:00$/', $header);
        self::assertSame($fetchedAt, (new \DateTimeImmutable($header))->getTimestamp());
    }

    public function testAStaleFeedIsStillServedButFlagged(): void
    {
        $body = '{"schemaVersion":1,"packages":[]}';
        $this->feedProvider->willReturn(new FeedResult($body, 1755561600, true));

        $raw = $this->execute(true);

        self::assertSame(200, $raw->getHttpResponseCode());
        self::assertSame($body, $raw->getBody());
        self::assertSame('1', $raw->getHeader(self::STALE_HEADER));
        self::assertSame('2025-08-19T00:00:00+00:00', $raw->getHeader(self::DATA_AS_OF_HEADER));
    }

    public function testAnUnavailableFeedAnswersWithTheMessageAsJson(): void
    {
        $this->feedProvider->willThrow(
            new FeedUnavailableException(__('The extension directory feed is unavailable and no cached copy exists yet.'))
        );

        $raw = $this->execute(true);

        self::assertSame(503, $raw->getHttpResponseCode());
        self::assertSame('application/json', $raw->getHeader('Content-Type'));
        self::assertSame(
            ['error' => 'The extension directory feed is unavailable and no cached copy exists yet.'],
            $raw->getDecodedBody()
        );
        self::assertNull($raw->getHeader(self::DATA_AS_OF_HEADER));
        self::assertNull($raw->getHeader(self::STALE_HEADER));
    }

    private function execute(bool $enabled): RecordingRaw
    {
        $config = new Config(new ArrayScopeConfig([Config::XML_PATH_ENABLED => $enabled ? '1' : '0']));
        $controller = new FeedController(new Context($this->resultFactory), $config, $this->feedProvider);

        $result = $controller->execute();

        self::assertSame($this->resultFactory->getRaw(), $result);

        return $this->resultFactory->getRaw();
    }
}
