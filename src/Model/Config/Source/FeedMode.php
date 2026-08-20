<?php
declare(strict_types=1);

namespace MageOS\ExtensionDirectory\Model\Config\Source;

use MageOS\ExtensionDirectory\Model\Config;
use Magento\Framework\Data\OptionSourceInterface;

class FeedMode implements OptionSourceInterface
{
    /**
     * @inheritDoc
     */
    public function toOptionArray(): array
    {
        return [
            [
                'value' => Config::FEED_MODE_PROXY,
                'label' => __('Server-side proxy (recommended)'),
            ],
            [
                'value' => Config::FEED_MODE_DIRECT,
                'label' => __('Browser fetches the directory host directly'),
            ],
        ];
    }
}
