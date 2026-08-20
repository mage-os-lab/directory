<?php
declare(strict_types=1);

namespace Magento\Framework\View\Asset;

if (!class_exists(Repository::class)) {
    /**
     * Test stub for Magento\Framework\View\Asset\Repository.
     */
    class Repository
    {
        public function getUrl($fileId)
        {
            throw new \RuntimeException(
                'The asset Repository stub resolves nothing; tests supply their own repository.'
            );
        }
    }
}
