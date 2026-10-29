<?php
declare(strict_types=1);

namespace Magento\Framework\App;

if (!interface_exists(CacheInterface::class)) {
    /**
     * Test stub for Magento\Framework\App\CacheInterface.
     */
    interface CacheInterface
    {
        public function getFrontend();

        public function load($identifier);

        public function save($data, $identifier, $tags = [], $lifeTime = null);

        public function remove($identifier);

        public function clean($tags = []);
    }
}
