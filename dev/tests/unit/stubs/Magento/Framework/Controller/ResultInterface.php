<?php
declare(strict_types=1);

namespace Magento\Framework\Controller;

if (!interface_exists(ResultInterface::class)) {
    /**
     * Test stub for Magento\Framework\Controller\ResultInterface.
     *
     * renderResult() is left out: it would drag in the response interface, and nothing under test
     * renders a result.
     */
    interface ResultInterface
    {
        public function setHttpResponseCode($httpCode);

        public function setHeader($name, $value, $replace = false);
    }
}
