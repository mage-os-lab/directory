<?php
declare(strict_types=1);

namespace Magento\Framework\App\Action;

use Magento\Framework\App\ActionInterface;

if (!interface_exists(HttpPostActionInterface::class)) {
    /**
     * Test stub for Magento\Framework\App\Action\HttpPostActionInterface.
     */
    interface HttpPostActionInterface extends ActionInterface
    {
    }
}
