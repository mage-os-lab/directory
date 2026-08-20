<?php
declare(strict_types=1);

namespace Magento\Framework\HTTP;

if (!class_exists(ClientFactory::class)) {
    /**
     * Test stub for Magento\Framework\HTTP\ClientFactory.
     */
    class ClientFactory
    {
        public function create(array $data = []): ClientInterface
        {
            throw new \RuntimeException(
                'The ClientFactory stub creates nothing; tests supply their own factory.'
            );
        }
    }
}
