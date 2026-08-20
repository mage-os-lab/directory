<?php
declare(strict_types=1);

namespace Magento\Framework\Controller\Result;

use Magento\Framework\Controller\ResultInterface;

if (!class_exists(Raw::class)) {
    /**
     * Test stub for Magento\Framework\Controller\Result\Raw.
     */
    class Raw implements ResultInterface
    {
        /**
         * @var mixed
         */
        protected $contents;

        /**
         * @var int|null
         */
        protected $statusCode;

        /**
         * @var array<int, array<string, mixed>>
         */
        protected $headers = [];

        public function setContents($contents)
        {
            $this->contents = $contents;

            return $this;
        }

        public function setHttpResponseCode($httpCode)
        {
            $this->statusCode = (int)$httpCode;

            return $this;
        }

        public function setHeader($name, $value, $replace = false)
        {
            $this->headers[] = ['name' => $name, 'value' => $value, 'replace' => $replace];

            return $this;
        }
    }
}
