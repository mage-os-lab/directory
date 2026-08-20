<?php
declare(strict_types=1);

namespace MageOS\ExtensionDirectory\Model\Cache;

use Magento\Framework\App\Cache\Type\FrontendPool;
use Magento\Framework\Cache\Frontend\Decorator\TagScope;

/**
 * Cache type holding the directory feed and the composer.lock snapshot.
 */
class Type extends TagScope
{
    public const TYPE_IDENTIFIER = 'mageos_extension_directory';

    public const CACHE_TAG = 'MAGEOS_EXTENSION_DIRECTORY';

    public function __construct(FrontendPool $cacheFrontendPool)
    {
        parent::__construct($cacheFrontendPool->get(self::TYPE_IDENTIFIER), self::CACHE_TAG);
    }
}
