<?php
declare(strict_types=1);

namespace MageOS\ExtensionDirectory\Model\Config\Source;

use MageOS\ExtensionDirectory\Model\Config;
use Magento\Framework\Data\OptionSourceInterface;

class InstallCommands implements OptionSourceInterface
{
    /**
     * @inheritDoc
     */
    public function toOptionArray(): array
    {
        return [
            [
                'value' => Config::INSTALL_COMMANDS_DEVELOPER,
                'label' => __('In developer mode (default)'),
            ],
            [
                'value' => Config::INSTALL_COMMANDS_ALWAYS,
                'label' => __('Always'),
            ],
            [
                'value' => Config::INSTALL_COMMANDS_NEVER,
                'label' => __('Never'),
            ],
        ];
    }
}
