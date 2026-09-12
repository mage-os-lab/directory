<?php
declare(strict_types=1);

namespace Magento\Framework\Controller\Result;

use Magento\Framework\Controller\ResultInterface;

if (!class_exists(Redirect::class)) {
    /**
     * Test stub for Magento\Framework\Controller\Result\Redirect.
     *
     * The real class resolves the path through the URL builder; the stub only remembers it.
     */
    class Redirect implements ResultInterface
    {
        /**
         * @var string|null
         */
        protected $path;

        /**
         * @var array<string, mixed>
         */
        protected $params = [];

        public function setPath($path, array $params = [])
        {
            $this->path = (string)$path;
            $this->params = $params;

            return $this;
        }

        public function setHttpResponseCode($httpCode)
        {
            return $this;
        }

        public function setHeader($name, $value, $replace = false)
        {
            return $this;
        }
    }
}
