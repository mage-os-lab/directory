<?php
declare(strict_types=1);

namespace Magento\Backend\App;

use Magento\Framework\App\ActionInterface;
use Magento\Framework\Controller\ResultFactory;
use Magento\Framework\Message\ManagerInterface;

if (!class_exists(Action::class)) {
    /**
     * Test stub for Magento\Backend\App\Action.
     *
     * The real base class wires request, response, session, ACL and more out of the context. The
     * module's controllers only ever reach for $this->resultFactory and $this->messageManager, so
     * that is all the stub takes.
     */
    abstract class Action implements ActionInterface
    {
        public const ADMIN_RESOURCE = 'Magento_Backend::admin';

        /**
         * @var ResultFactory
         */
        protected $resultFactory;

        /**
         * @var ManagerInterface|null
         */
        protected $messageManager;

        public function __construct(Action\Context $context)
        {
            $this->resultFactory = $context->getResultFactory();
            $this->messageManager = $context->getMessageManager();
        }
    }
}
