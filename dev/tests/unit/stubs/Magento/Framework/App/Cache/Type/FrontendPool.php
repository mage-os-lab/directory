<?php
declare(strict_types=1);

namespace Magento\Framework\App\Cache\Type;

if (!class_exists(FrontendPool::class)) {
    /**
     * Test stub for Magento\Framework\App\Cache\Type\FrontendPool.
     *
     * Returns a null frontend: the TagScope stub a cache type extends stores entries itself, so
     * there is nothing for the pool to hand out.
     */
    class FrontendPool
    {
        public function get($cacheType)
        {
            return null;
        }
    }
}
