<?php
declare(strict_types=1);

namespace Magento\Framework\App\Config\Storage;

use Magento\Framework\App\Config\ScopeConfigInterface;

if (!interface_exists(WriterInterface::class)) {
    /**
     * Test stub for Magento\Framework\App\Config\Storage\WriterInterface.
     */
    interface WriterInterface
    {
        public function delete($path, $scope = ScopeConfigInterface::SCOPE_TYPE_DEFAULT, $scopeId = 0);

        public function save($path, $value, $scope = ScopeConfigInterface::SCOPE_TYPE_DEFAULT, $scopeId = 0);
    }
}
