<?php
declare(strict_types=1);

namespace MageOS\ExtensionDirectory\Model\Config\Source;

use MageOS\ExtensionDirectory\Model\Config;
use Magento\Framework\Data\OptionSourceInterface;

class BundleSource implements OptionSourceInterface
{
    /**
     * @inheritDoc
     */
    public function toOptionArray(): array
    {
        return [
            [
                'value' => Config::BUNDLE_SOURCE_BUNDLED,
                'label' => __('Bundled with this module (recommended)'),
            ],
            [
                'value' => Config::BUNDLE_SOURCE_REMOTE,
                'label' => __('Load from the directory host'),
            ],
        ];
    }
}
