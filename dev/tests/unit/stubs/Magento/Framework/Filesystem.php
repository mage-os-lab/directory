<?php
declare(strict_types=1);

namespace Magento\Framework;

if (!class_exists(Filesystem::class)) {
    /**
     * Test stub for Magento\Framework\Filesystem.
     */
    class Filesystem
    {
        public function getDirectoryRead($directoryCode, $driverCode = 'file')
        {
            throw new \RuntimeException(
                'The Filesystem stub opens nothing; tests supply their own filesystem.'
            );
        }
    }
}
