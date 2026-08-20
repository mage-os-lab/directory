<?php
declare(strict_types=1);

namespace MageOS\ExtensionDirectory\Test\Unit\Fake;

use Magento\Framework\Controller\ResultFactory;

/**
 * Hands out one RecordingRaw and remembers which result type was asked for.
 */
final class FakeResultFactory extends ResultFactory
{
    private RecordingRaw $raw;

    /**
     * @var list<string>
     */
    private array $requestedTypes = [];

    /**
     * Deliberately does not call the parent constructor: there is no object manager to hand it.
     */
    public function __construct(?RecordingRaw $raw = null)
    {
        $this->raw = $raw ?? new RecordingRaw();
    }

    public function create($type = self::TYPE_PAGE, array $arguments = [])
    {
        $this->requestedTypes[] = (string)$type;

        return $this->raw;
    }

    public function getRaw(): RecordingRaw
    {
        return $this->raw;
    }

    /**
     * @return list<string>
     */
    public function getRequestedTypes(): array
    {
        return $this->requestedTypes;
    }
}
