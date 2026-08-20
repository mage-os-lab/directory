<?php
declare(strict_types=1);

namespace Magento\Framework\App\Action;

use Magento\Framework\App\ActionInterface;

if (!interface_exists(HttpGetActionInterface::class)) {
    /**
     * Test stub for Magento\Framework\App\Action\HttpGetActionInterface.
     */
    interface HttpGetActionInterface extends ActionInterface
    {
    }
}
