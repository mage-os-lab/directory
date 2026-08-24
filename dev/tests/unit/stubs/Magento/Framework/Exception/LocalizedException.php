<?php
declare(strict_types=1);

namespace Magento\Framework\Exception;

use Magento\Framework\Phrase;

if (!class_exists(LocalizedException::class)) {
    /**
     * Test stub for Magento\Framework\Exception\LocalizedException.
     */
    class LocalizedException extends \Exception
    {
        /**
         * @var Phrase
         */
        protected $phrase;

        public function __construct(Phrase $phrase, ?\Exception $cause = null, $code = 0)
        {
            $this->phrase = $phrase;

            parent::__construct($phrase->render(), (int)$code, $cause);
        }

        public function getRawMessage(): string
        {
            return $this->phrase->getText();
        }

        public function getParameters(): array
        {
            return $this->phrase->getArguments();
        }

        public function getLogMessage(): string
        {
            return $this->getMessage();
        }
    }
}
