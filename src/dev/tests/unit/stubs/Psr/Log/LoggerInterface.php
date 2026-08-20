<?php
declare(strict_types=1);

namespace Psr\Log;

if (!interface_exists(LoggerInterface::class)) {
    /**
     * Test stub for Psr\Log\LoggerInterface.
     *
     * Parameters are left untyped so an implementation written against this stub also satisfies
     * psr/log 1.x, 2.x and 3.x when the real package is present.
     */
    interface LoggerInterface
    {
        public function emergency($message, array $context = []): void;

        public function alert($message, array $context = []): void;

        public function critical($message, array $context = []): void;

        public function error($message, array $context = []): void;

        public function warning($message, array $context = []): void;

        public function notice($message, array $context = []): void;

        public function info($message, array $context = []): void;

        public function debug($message, array $context = []): void;

        public function log($level, $message, array $context = []): void;
    }
}
