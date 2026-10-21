<?php
declare(strict_types=1);

namespace Magento\Framework\App;

if (!class_exists(State::class)) {
    /**
     * Test stub for Magento\Framework\App\State: the deploy-mode constants and getMode().
     */
    class State
    {
        public const MODE_DEVELOPER = 'developer';
        public const MODE_PRODUCTION = 'production';
        public const MODE_DEFAULT = 'default';

        public function getMode()
        {
            return self::MODE_DEFAULT;
        }
    }
}
