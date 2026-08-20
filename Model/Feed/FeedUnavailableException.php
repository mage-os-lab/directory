<?php
declare(strict_types=1);

namespace MageOS\ExtensionDirectory\Model\Feed;

use Magento\Framework\Exception\LocalizedException;

/**
 * Thrown when the feed cannot be fetched and no cached copy is available to fall back on.
 */
class FeedUnavailableException extends LocalizedException
{
}
