<?php
declare(strict_types=1);

namespace Magento\Framework\App;

if (!interface_exists(ActionInterface::class)) {
    /**
     * Test stub for Magento\Framework\App\ActionInterface.
     */
    interface ActionInterface
    {
        public const FLAG_NO_DISPATCH = 'no-dispatch';

        public function execute();
    }
}
