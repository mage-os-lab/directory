<?php
declare(strict_types=1);

namespace Magento\Framework\Controller;

if (!class_exists(ResultFactory::class)) {
    /**
     * Test stub for Magento\Framework\Controller\ResultFactory.
     */
    class ResultFactory
    {
        public const TYPE_JSON = 'json';
        public const TYPE_PAGE = 'page';
        public const TYPE_RAW = 'raw';
        public const TYPE_REDIRECT = 'redirect';

        public function create($type = self::TYPE_PAGE, array $arguments = [])
        {
            throw new \RuntimeException(
                'The ResultFactory stub creates nothing; tests supply their own factory.'
            );
        }
    }
}
