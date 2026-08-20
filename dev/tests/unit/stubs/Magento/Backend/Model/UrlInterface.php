<?php
declare(strict_types=1);

namespace Magento\Backend\Model;

if (!interface_exists(UrlInterface::class)) {
    /**
     * Test stub for Magento\Backend\Model\UrlInterface.
     *
     * Narrowed to getUrl(), the only method the view model calls. The real interface inherits the
     * rest of Magento\Framework\UrlInterface and adds secret-key handling on top.
     */
    interface UrlInterface
    {
        public function getUrl($routePath = null, $routeParams = null);
    }
}
