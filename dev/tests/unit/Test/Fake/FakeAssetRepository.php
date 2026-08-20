<?php
declare(strict_types=1);

namespace MageOS\ExtensionDirectory\Test\Unit\Fake;

use Magento\Framework\View\Asset\Repository;

/**
 * Resolves an asset id to a static URL the way a deployed adminhtml theme would.
 */
final class FakeAssetRepository extends Repository
{
    public const STATIC_BASE = 'https://shop.example.com/static/adminhtml/Magento/backend/en_US/';

    /**
     * @var list<string>
     */
    private array $requestedAssetIds = [];

    /**
     * Deliberately does not call the parent constructor: no design or asset source is involved.
     */
    public function __construct()
    {
    }

    public function getUrl($fileId)
    {
        $this->requestedAssetIds[] = (string)$fileId;

        return self::STATIC_BASE . str_replace('::', '/', (string)$fileId);
    }

    /**
     * @return list<string>
     */
    public function getRequestedAssetIds(): array
    {
        return $this->requestedAssetIds;
    }
}
