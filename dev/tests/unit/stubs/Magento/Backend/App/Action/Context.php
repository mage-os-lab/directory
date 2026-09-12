<?php
declare(strict_types=1);

namespace Magento\Backend\App\Action;

use Magento\Framework\Controller\ResultFactory;
use Magento\Framework\Message\ManagerInterface;

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

        /**
         * @var ManagerInterface|null
         */
        private $messageManager;

        public function __construct(ResultFactory $resultFactory, ?ManagerInterface $messageManager = null)
        {
            $this->resultFactory = $resultFactory;
            $this->messageManager = $messageManager;
        }

        public function getResultFactory(): ResultFactory
        {
            return $this->resultFactory;
        }

        public function getMessageManager(): ?ManagerInterface
        {
            return $this->messageManager;
        }
    }
}
