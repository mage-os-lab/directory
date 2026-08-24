<?php
declare(strict_types=1);

namespace Magento\Backend\App\Action;

use Magento\Framework\Controller\ResultFactory;

if (!class_exists(Context::class)) {
    /**
     * Test stub for Magento\Backend\App\Action\Context.
     */
    class Context
    {
        /**
         * @var ResultFactory
         */
        private $resultFactory;

        public function __construct(ResultFactory $resultFactory)
        {
            $this->resultFactory = $resultFactory;
        }

        public function getResultFactory(): ResultFactory
        {
            return $this->resultFactory;
        }
    }
}
