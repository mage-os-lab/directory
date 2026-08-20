<?php
declare(strict_types=1);

namespace MageOS\ExtensionDirectory\Test\Unit\Fake;

use Magento\Framework\Filesystem;

/**
 * Hands out one prepared directory read and records which directory code was asked for.
 */
final class FakeFilesystem extends Filesystem
{
    private FakeDirectoryRead $directoryRead;

    /**
     * @var list<string>
     */
    private array $requestedDirectoryCodes = [];

    /**
     * Deliberately does not call the parent constructor: there are no real directory pools here.
     */
    public function __construct(FakeDirectoryRead $directoryRead)
    {
        $this->directoryRead = $directoryRead;
    }

    public function getDirectoryRead($directoryCode, $driverCode = 'file')
    {
        $this->requestedDirectoryCodes[] = (string)$directoryCode;

        return $this->directoryRead;
    }

    /**
     * @return list<string>
     */
    public function getRequestedDirectoryCodes(): array
    {
        return $this->requestedDirectoryCodes;
    }
}
