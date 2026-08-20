<?php
declare(strict_types=1);

namespace MageOS\ExtensionDirectory\Test\Unit\Model\Config\Source;

use MageOS\ExtensionDirectory\Model\Config;
use MageOS\ExtensionDirectory\Model\Config\Source\BundleSource;
use MageOS\ExtensionDirectory\Model\Config\Source\FeedMode;
use MageOS\ExtensionDirectory\Test\Unit\Fake\ArrayScopeConfig;
use PHPUnit\Framework\TestCase;

/**
 * The dropdowns in system.xml have to offer exactly the values Config is willing to accept back:
 * an option the reader does not recognise silently turns into the default.
 */
final class OptionSourcesTest extends TestCase
{
    public function testTheFeedModeOptionsAreTheValuesConfigAcceptsBack(): void
    {
        $options = (new FeedMode())->toOptionArray();

        self::assertSame(
            [Config::FEED_MODE_PROXY, Config::FEED_MODE_DIRECT],
            array_column($options, 'value')
        );
        foreach ($options as $option) {
            self::assertNotSame('', (string)$option['label']);
            self::assertSame($option['value'], $this->config(Config::XML_PATH_FEED_MODE, $option['value'])->getFeedMode());
        }
    }

    public function testTheBundleSourceOptionsAreTheValuesConfigAcceptsBack(): void
    {
        $options = (new BundleSource())->toOptionArray();

        self::assertSame(
            [Config::BUNDLE_SOURCE_BUNDLED, Config::BUNDLE_SOURCE_REMOTE],
            array_column($options, 'value')
        );
        foreach ($options as $option) {
            self::assertNotSame('', (string)$option['label']);
            self::assertSame(
                $option['value'],
                $this->config(Config::XML_PATH_BUNDLE_SOURCE, $option['value'])->getBundleSource()
            );
        }
    }

    private function config(string $path, string $value): Config
    {
        return new Config(new ArrayScopeConfig([$path => $value]));
    }
}
