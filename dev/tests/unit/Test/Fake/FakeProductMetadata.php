<?php
declare(strict_types=1);

namespace MageOS\ExtensionDirectory\Test\Unit\Fake;

use Magento\Framework\App\ProductMetadataInterface;

/**
 * Reports a fixed application version, name and edition.
 */
final class FakeProductMetadata implements ProductMetadataInterface
{
    private string $version;

    public function __construct(string $version = '2.4.7-p3')
    {
        $this->version = $version;
    }

    public function getVersion()
    {
        return $this->version;
    }

    public function getEdition()
    {
        return 'Community';
    }

    public function getName()
    {
        return 'Magento';
    }
}
