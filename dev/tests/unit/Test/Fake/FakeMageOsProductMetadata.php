<?php
declare(strict_types=1);

namespace MageOS\ExtensionDirectory\Test\Unit\Fake;

use Magento\Framework\App\ProductMetadataInterface;

/**
 * A host that also answers the two distribution methods Mage-OS adds to its concrete
 * ProductMetadata. They are deliberately absent from the interface, exactly as upstream.
 */
final class FakeMageOsProductMetadata implements ProductMetadataInterface
{
    public function __construct(
        private readonly string $version = '2.4.9',
        private readonly string $distributionName = 'Mage-OS',
        private readonly string $distributionVersion = '3.5.0'
    ) {
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

    public function getDistributionName(): string
    {
        return $this->distributionName;
    }

    public function getDistributionVersion(): string
    {
        return $this->distributionVersion;
    }
}
