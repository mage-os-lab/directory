<?php
declare(strict_types=1);

namespace Magento\Backend\App;

use Magento\Framework\App\ActionInterface;
use Magento\Framework\Controller\ResultFactory;

if (!class_exists(Action::class)) {
    /**
     * Test stub for Magento\Backend\App\Action.
     *
     * The real base class wires request, response, session, ACL and more out of the context. The
     * feed controller only ever reaches for $this->resultFactory, so that is all the stub takes.
     */
    abstract class Action implements ActionInterface
    {
        public const ADMIN_RESOURCE = 'Magento_Backend::admin';

        /**
         * @var ResultFactory
         */
        protected $resultFactory;

        public function __construct(Action\Context $context)
        {
            $this->resultFactory = $context->getResultFactory();
        }
    }
}
