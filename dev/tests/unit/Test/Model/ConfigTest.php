<?php
declare(strict_types=1);

namespace MageOS\ExtensionDirectory\Test\Unit\Model;

use MageOS\ExtensionDirectory\Model\Config;
use MageOS\ExtensionDirectory\Test\Unit\Fake\ArrayScopeConfig;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

final class ConfigTest extends TestCase
{
    public function testEnabledReflectsTheStoredFlag(): void
    {
        self::assertTrue($this->config([Config::XML_PATH_ENABLED => '1'])->isEnabled());
        self::assertFalse($this->config([Config::XML_PATH_ENABLED => '0'])->isEnabled());
        self::assertFalse($this->config([])->isEnabled());
    }

    #[DataProvider('baseUrlProvider')]
    public function testBaseUrlIsTrimmedOfWhitespaceAndTrailingSlashes(mixed $stored, string $expected): void
    {
        self::assertSame($expected, $this->config([Config::XML_PATH_BASE_URL => $stored])->getBaseUrl());
    }

    public static function baseUrlProvider(): array
    {
        return [
            'plain' => ['https://rhoerr.github.io/mage-os.directory', 'https://rhoerr.github.io/mage-os.directory'],
            'trailing slash' => ['https://example.com/directory/', 'https://example.com/directory'],
            'several trailing slashes' => ['https://example.com/directory///', 'https://example.com/directory'],
            'surrounding whitespace' => ['  https://example.com/directory  ', 'https://example.com/directory'],
            'whitespace after the slash' => ["https://example.com/directory/\n", 'https://example.com/directory'],
            'unset' => [null, ''],
            'empty' => ['', ''],
        ];
    }

    #[DataProvider('feedModeProvider')]
    public function testFeedModeFallsBackToProxyForAnythingUnrecognised(mixed $stored, string $expected): void
    {
        self::assertSame($expected, $this->config([Config::XML_PATH_FEED_MODE => $stored])->getFeedMode());
    }

    public static function feedModeProvider(): array
    {
        return [
            'direct' => ['direct', Config::FEED_MODE_DIRECT],
            'proxy' => ['proxy', Config::FEED_MODE_PROXY],
            'junk' => ['sideways', Config::FEED_MODE_PROXY],
            'wrong case' => ['Direct', Config::FEED_MODE_PROXY],
            'unset' => [null, Config::FEED_MODE_PROXY],
            'empty' => ['', Config::FEED_MODE_PROXY],
        ];
    }

    #[DataProvider('bundleSourceProvider')]
    public function testBundleSourceFallsBackToBundledForAnythingUnrecognised(mixed $stored, string $expected): void
    {
        self::assertSame($expected, $this->config([Config::XML_PATH_BUNDLE_SOURCE => $stored])->getBundleSource());
    }

    public static function bundleSourceProvider(): array
    {
        return [
            'remote' => ['remote', Config::BUNDLE_SOURCE_REMOTE],
            'bundled' => ['bundled', Config::BUNDLE_SOURCE_BUNDLED],
            'junk' => ['cdn', Config::BUNDLE_SOURCE_BUNDLED],
            'wrong case' => ['Remote', Config::BUNDLE_SOURCE_BUNDLED],
            'unset' => [null, Config::BUNDLE_SOURCE_BUNDLED],
            'empty' => ['', Config::BUNDLE_SOURCE_BUNDLED],
        ];
    }

    #[DataProvider('cacheTtlProvider')]
    public function testCacheTtlDefaultsAndFloor(mixed $stored, int $expected): void
    {
        self::assertSame($expected, $this->config([Config::XML_PATH_CACHE_TTL => $stored])->getCacheTtl());
    }

    public static function cacheTtlProvider(): array
    {
        return [
            'configured' => ['7200', 7200],
            'non numeric' => ['abc', 3600],
            'zero' => ['0', 3600],
            'negative' => ['-5', 3600],
            'unset' => [null, 3600],
            'below the floor' => ['30', 60],
            'exactly the floor' => ['60', 60],
            'the default itself' => ['3600', 3600],
        ];
    }

    #[DataProvider('httpTimeoutProvider')]
    public function testHttpTimeoutDefaultsAndFloor(mixed $stored, int $expected): void
    {
        self::assertSame($expected, $this->config([Config::XML_PATH_HTTP_TIMEOUT => $stored])->getHttpTimeout());
    }

    public static function httpTimeoutProvider(): array
    {
        return [
            'configured' => ['30', 30],
            'non numeric' => ['abc', 10],
            'zero' => ['0', 10],
            'negative' => ['-3', 10],
            'unset' => [null, 10],
            'the floor' => ['1', 1],
        ];
    }

    public function testEveryValueIsReadFromItsDocumentedConfigPath(): void
    {
        $config = $this->config([
            'mageos_extension_directory/general/enabled' => '1',
            'mageos_extension_directory/general/base_url' => 'https://example.com/directory/',
            'mageos_extension_directory/general/feed_mode' => 'direct',
            'mageos_extension_directory/general/bundle_source' => 'remote',
            'mageos_extension_directory/general/cache_ttl' => '900',
            'mageos_extension_directory/general/http_timeout' => '5',
        ]);

        self::assertTrue($config->isEnabled());
        self::assertSame('https://example.com/directory', $config->getBaseUrl());
        self::assertSame(Config::FEED_MODE_DIRECT, $config->getFeedMode());
        self::assertSame(Config::BUNDLE_SOURCE_REMOTE, $config->getBundleSource());
        self::assertSame(900, $config->getCacheTtl());
        self::assertSame(5, $config->getHttpTimeout());
    }

    /**
     * @param array<string, mixed> $values
     */
    private function config(array $values): Config
    {
        return new Config(new ArrayScopeConfig($values));
    }
}
