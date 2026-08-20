<?php
declare(strict_types=1);

namespace Magento\Framework\Data;

if (!interface_exists(OptionSourceInterface::class)) {
    /**
     * Test stub for Magento\Framework\Data\OptionSourceInterface.
     */
    interface OptionSourceInterface
    {
        public function toOptionArray();
    }
}
