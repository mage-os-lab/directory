<?php
declare(strict_types=1);

namespace Magento\Framework;

if (!interface_exists(AuthorizationInterface::class)) {
    /**
     * Test stub for Magento\Framework\AuthorizationInterface.
     */
    interface AuthorizationInterface
    {
        public function isAllowed($resource, $privilege = null);
    }
}
