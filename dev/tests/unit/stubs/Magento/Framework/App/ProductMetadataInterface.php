<?php
declare(strict_types=1);

namespace Magento\Framework\App;

if (!interface_exists(ProductMetadataInterface::class)) {
    /**
     * Test stub for Magento\Framework\App\ProductMetadataInterface.
     */
    interface ProductMetadataInterface
    {
        public function getVersion();

        public function getEdition();

        public function getName();
    }
}
