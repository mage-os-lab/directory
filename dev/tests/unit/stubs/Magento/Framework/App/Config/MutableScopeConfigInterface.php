<?php
declare(strict_types=1);

namespace Magento\Framework\App\Config;

if (!interface_exists(MutableScopeConfigInterface::class)) {
    /**
     * Test stub for Magento\Framework\App\Config\MutableScopeConfigInterface.
     */
    interface MutableScopeConfigInterface extends ScopeConfigInterface
    {
        public function setValue($path, $value, $scopeType = self::SCOPE_TYPE_DEFAULT, $scopeCode = null);
    }
}
