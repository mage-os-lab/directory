<?php
declare(strict_types=1);

namespace Magento\Framework\App\Config;

if (!interface_exists(ScopeConfigInterface::class)) {
    /**
     * Test stub for Magento\Framework\App\Config\ScopeConfigInterface.
     */
    interface ScopeConfigInterface
    {
        public const SCOPE_TYPE_DEFAULT = 'default';

        public function getValue($path = null, $scopeType = self::SCOPE_TYPE_DEFAULT, $scopeCode = null);

        public function isSetFlag($path, $scopeType = self::SCOPE_TYPE_DEFAULT, $scopeCode = null);
    }
}
