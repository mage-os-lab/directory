<?php
declare(strict_types=1);

namespace Magento\Framework;

if (!class_exists(Phrase::class)) {
    /**
     * Test stub for Magento\Framework\Phrase.
     *
     * The real class delegates rendering to an injected renderer; the stub substitutes the
     * positional (%1, %2, ...) and named (%name) placeholders the renderer supports.
     */
    class Phrase
    {
        /**
         * @var string
         */
        private $text;

        /**
         * @var array
         */
        private $arguments;

        public function __construct($text, array $arguments = [])
        {
            $this->text = (string)$text;
            $this->arguments = $arguments;
        }

        public function getText(): string
        {
            return $this->text;
        }

        public function getArguments(): array
        {
            return $this->arguments;
        }

        public function render(): string
        {
            if ($this->arguments === []) {
                return $this->text;
            }

            $placeholders = [];
            $position = 1;
            foreach ($this->arguments as $key => $value) {
                if (is_string($key)) {
                    $placeholders['%' . $key] = (string)$value;
                    continue;
                }
                $placeholders['%' . $position++] = (string)$value;
            }

            return strtr($this->text, $placeholders);
        }

        public function __toString(): string
        {
            return $this->render();
        }
    }
}
