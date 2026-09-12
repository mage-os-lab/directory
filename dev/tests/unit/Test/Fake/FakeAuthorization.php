<?php
declare(strict_types=1);

namespace MageOS\ExtensionDirectory\Test\Unit\Fake;

use Magento\Framework\AuthorizationInterface;

/**
 * Allows exactly the resources it was given, and remembers every resource it was asked about.
 */
final class FakeAuthorization implements AuthorizationInterface
{
    /**
     * @var list<string>
     */
    private array $asked = [];

    /**
     * @param list<string> $allowed
     */
    public function __construct(private readonly array $allowed = [])
    {
    }

    public function isAllowed($resource, $privilege = null)
    {
        $this->asked[] = (string)$resource;

        return in_array((string)$resource, $this->allowed, true);
    }

    /**
     * @return list<string>
     */
    public function getAskedResources(): array
    {
        return $this->asked;
    }
}
