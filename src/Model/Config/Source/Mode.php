<?php
declare(strict_types=1);

namespace MageOS\ExtensionDirectory\Model\Config\Source;

use MageOS\ExtensionDirectory\Model\Config;
use Magento\Framework\Data\OptionSourceInterface;

class Mode implements OptionSourceInterface
{
    /**
     * @inheritDoc
     */
    public function toOptionArray(): array
    {
        return [
            [
                'value' => Config::MODE_DIRECT,
                'label' => __('Direct — load from the directory host (default)'),
            ],
            [
                'value' => Config::MODE_PROXY,
                'label' => __('Proxy — serve through this store'),
            ],
        ];
    }
}
