<?php
declare(strict_types=1);

namespace Magento\Framework\HTTP;

if (!interface_exists(ClientInterface::class)) {
    /**
     * Test stub for Magento\Framework\HTTP\ClientInterface.
     *
     * Narrowed to the four methods the feed provider calls.
     */
    interface ClientInterface
    {
        public function setTimeout($value);

        public function get($uri);

        public function getStatus();

        public function getBody();
    }
}
