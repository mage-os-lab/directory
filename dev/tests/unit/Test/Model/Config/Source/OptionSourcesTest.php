<?php
declare(strict_types=1);

namespace MageOS\ExtensionDirectory\Test\Unit\Model\Config\Source;

use MageOS\ExtensionDirectory\Model\Config;
use MageOS\ExtensionDirectory\Model\Config\Source\Mode;
use MageOS\ExtensionDirectory\Test\Unit\Fake\ArrayScopeConfig;
use PHPUnit\Framework\TestCase;

/**
 * The dropdown in system.xml has to offer exactly the values Config is willing to accept back:
 * an option the reader does not recognise silently turns into the default.
 */
final class OptionSourcesTest extends TestCase
{
    public function testTheModeOptionsAreTheValuesConfigAcceptsBack(): void
    {
        $options = (new Mode())->toOptionArray();

        self::assertSame(
            [Config::MODE_DIRECT, Config::MODE_PROXY],
            array_column($options, 'value'),
            'Direct is the default, so it is offered first.'
        );

        foreach ($options as $option) {
            self::assertNotSame('', (string)$option['label']);
            self::assertSame($option['value'], $this->config($option['value'])->getMode());
        }
    }

    private function config(string $mode): Config
    {
        return new Config(new ArrayScopeConfig([Config::XML_PATH_MODE => $mode]));
    }
}
