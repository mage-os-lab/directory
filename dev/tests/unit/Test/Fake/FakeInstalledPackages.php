<?php
declare(strict_types=1);

namespace MageOS\ExtensionDirectory\Test\Unit\Fake;

use MageOS\ExtensionDirectory\Model\ComposerLock\InstalledPackages;

/**
 * Returns a composer name => version map the test decides on.
 */
final class FakeInstalledPackages extends InstalledPackages
{
    /**
     * @var array<string, string>
     */
    private array $map;

    /**
     * Deliberately does not call the parent constructor: nothing here reads a composer.lock.
     *
     * @param array<string, string> $map
     */
    public function __construct(array $map = [])
    {
        $this->map = $map;
    }

    /**
     * @return array<string, string>
     */
    public function getMap(): array
    {
        return $this->map;
    }
}
