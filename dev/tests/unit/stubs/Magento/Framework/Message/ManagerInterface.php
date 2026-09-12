<?php
declare(strict_types=1);

namespace Magento\Framework\Message;

if (!interface_exists(ManagerInterface::class)) {
    /**
     * Test stub for Magento\Framework\Message\ManagerInterface — only what the module calls.
     */
    interface ManagerInterface
    {
        public function addSuccessMessage($message, $group = null);

        public function addNoticeMessage($message, $group = null);
    }
}
