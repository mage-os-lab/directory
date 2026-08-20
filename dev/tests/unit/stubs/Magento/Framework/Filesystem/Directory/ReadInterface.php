<?php
declare(strict_types=1);

namespace Magento\Framework\Filesystem\Directory;

if (!interface_exists(ReadInterface::class)) {
    /**
     * Test stub for Magento\Framework\Filesystem\Directory\ReadInterface.
     *
     * Narrowed to the three methods the composer.lock reader calls.
     */
    interface ReadInterface
    {
        public function isFile($path);

        public function stat($path);

        public function readFile($path, $flag = null, $context = null);
    }
}
