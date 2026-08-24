<?php
declare(strict_types=1);

namespace MageOS\ExtensionDirectory\Test\Unit\Model;

use MageOS\ExtensionDirectory\Model\Config;
use MageOS\ExtensionDirectory\Test\Unit\Fake\ArrayScopeConfig;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

final class ConfigTest extends TestCase
{
    #[DataProvider('modeProvider')]
    public function testModeFallsBackToDirectForAnythingUnrecognised(mixed $stored, string $expected): void
    {
        self::assertSame($expected, $this->config([Config::XML_PATH_MODE => $stored])->getMode());
    }

    public static function modeProvider(): array
    {
        return [
            'direct' => ['direct', Config::MODE_DIRECT],
            'proxy' => ['proxy', Config::MODE_PROXY],
            'junk' => ['sideways', Config::MODE_DIRECT],
            'wrong case' => ['Proxy', Config::MODE_DIRECT],
            'unset' => [null, Config::MODE_DIRECT],
            'empty' => ['', Config::MODE_DIRECT],
        ];
    }

    public function testIsProxyIsTrueOnlyForTheProxyMode(): void
    {
        self::assertTrue($this->config([Config::XML_PATH_MODE => 'proxy'])->isProxy());
        self::assertFalse($this->config([Config::XML_PATH_MODE => 'direct'])->isProxy());
        self::assertFalse($this->config([Config::XML_PATH_MODE => 'sideways'])->isProxy());
        self::assertFalse($this->config([])->isProxy(), 'Direct is the shipped default.');
    }

    public function testTheModeIsReadFromItsDocumentedConfigPath(): void
    {
        $config = $this->config(['mageos_extension_directory/general/mode' => 'proxy']);

        self::assertSame(Config::MODE_PROXY, $config->getMode());
        self::assertTrue($config->isProxy());
    }

    public function testTheBaseUrlIsTheShippedConstantWithoutATrailingSlash(): void
    {
        $baseUrl = $this->config([])->getBaseUrl();

        self::assertSame(Config::BASE_URL, $baseUrl);
        self::assertSame('https://rhoerr.github.io/mage-os.directory', $baseUrl);
        self::assertSame(rtrim($baseUrl, '/'), $baseUrl);
    }

    public function testTheProxyTimingsAreTheShippedConstants(): void
    {
        $config = $this->config([]);

        self::assertSame(3600, $config->getCacheTtl());
        self::assertSame(Config::CACHE_TTL, $config->getCacheTtl());
        self::assertSame(10, $config->getHttpTimeout());
        self::assertSame(Config::HTTP_TIMEOUT, $config->getHttpTimeout());
    }

    /**
     * The constants are deliberately not settings, so a leftover row from an older release
     * must not change what the module does.
     */
    public function testStoredValuesFromAnEarlierReleaseCannotOverrideTheConstants(): void
    {
        $config = $this->config([
            'mageos_extension_directory/general/base_url' => 'https://leftover.example.com/',
            'mageos_extension_directory/general/cache_ttl' => '900',
            'mageos_extension_directory/general/http_timeout' => '5',
        ]);

        self::assertSame(Config::BASE_URL, $config->getBaseUrl());
        self::assertSame(Config::CACHE_TTL, $config->getCacheTtl());
        self::assertSame(Config::HTTP_TIMEOUT, $config->getHttpTimeout());
    }

    /**
     * @param array<string, mixed> $values
     */
    private function config(array $values): Config
    {
        return new Config(new ArrayScopeConfig($values));
    }
}
