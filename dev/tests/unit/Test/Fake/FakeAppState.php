<?php
declare(strict_types=1);

namespace MageOS\ExtensionDirectory\Test\Unit\Fake;

use Magento\Framework\App\State;

/**
 * Reports whichever deploy mode the test asks for.
 */
final class FakeAppState extends State
{
    /**
     * Deliberately does not call the parent constructor: no deployment config is involved.
     */
    public function __construct(
        private readonly string $mode = State::MODE_PRODUCTION
    ) {
    }

    public function getMode()
    {
        return $this->mode;
    }
}
