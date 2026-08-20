<?php
/**
 * Magento's global translation helper.
 *
 * A function cannot be autoloaded, so the bootstrap requires this file directly. The guard keeps
 * the real helper (registered through magento/framework's "files" autoload) in charge whenever the
 * suite runs inside a Magento installation.
 */
declare(strict_types=1);

use Magento\Framework\Phrase;

if (!function_exists('__')) {
    function __($text, ...$arguments): Phrase
    {
        if (isset($arguments[0]) && is_array($arguments[0])) {
            $arguments = $arguments[0];
        }

        return new Phrase((string)$text, $arguments);
    }
}
