<?php
declare(strict_types=1);

namespace Magento\Framework\Cache\Frontend\Decorator;

if (!class_exists(TagScope::class)) {
    /**
     * Test stub for Magento\Framework\Cache\Frontend\Decorator\TagScope.
     *
     * The real decorator forwards to an injected cache frontend and forces a tag onto every write.
     * The stub keeps the same public surface but stores entries in memory, so a cache type that
     * extends it behaves like a working cache without a backend. The constructor deliberately
     * accepts anything: the frontend pool stub hands it a null frontend.
     */
    class TagScope
    {
        /**
         * @var array<string, string>
         */
        private $entries = [];

        /**
         * @var string
         */
        private $tag;

        public function __construct($frontend = null, $tag = '')
        {
            $this->tag = (string)$tag;
        }

        public function getTag(): string
        {
            return $this->tag;
        }

        public function save($data, $identifier, array $tags = [], $lifeTime = null)
        {
            $this->entries[(string)$identifier] = (string)$data;

            return true;
        }

        public function load($identifier)
        {
            return $this->entries[(string)$identifier] ?? false;
        }

        public function remove($identifier)
        {
            unset($this->entries[(string)$identifier]);

            return true;
        }

        public function clean($mode = 'all', array $tags = [])
        {
            $this->entries = [];

            return true;
        }
    }
}
