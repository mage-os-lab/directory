<?php
declare(strict_types=1);

namespace Magento\Framework\App\Config;

if (!interface_exists(ReinitableConfigInterface::class)) {
    /**
     * Test stub for Magento\Framework\App\Config\ReinitableConfigInterface.
     */
    interface ReinitableConfigInterface extends MutableScopeConfigInterface
    {
        public function reinit();
    }
}
