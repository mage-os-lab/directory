<?php
declare(strict_types=1);

namespace MageOS\ExtensionDirectory\Test\Unit\Fake;

use Magento\Framework\Controller\ResultFactory;

/**
 * Hands out one RecordingRaw (or, for TYPE_REDIRECT, one RecordingRedirect) and remembers which
 * result type was asked for.
 */
final class FakeResultFactory extends ResultFactory
{
    private RecordingRaw $raw;

    private RecordingRedirect $redirect;

    /**
     * @var list<string>
     */
    private array $requestedTypes = [];

    /**
     * Deliberately does not call the parent constructor: there is no object manager to hand it.
     */
    public function __construct(?RecordingRaw $raw = null, ?RecordingRedirect $redirect = null)
    {
        $this->raw = $raw ?? new RecordingRaw();
        $this->redirect = $redirect ?? new RecordingRedirect();
    }

    public function create($type = self::TYPE_PAGE, array $arguments = [])
    {
        $this->requestedTypes[] = (string)$type;

        return $type === self::TYPE_REDIRECT ? $this->redirect : $this->raw;
    }

    public function getRaw(): RecordingRaw
    {
        return $this->raw;
    }

    public function getRedirect(): RecordingRedirect
    {
        return $this->redirect;
    }

    /**
     * @return list<string>
     */
    public function getRequestedTypes(): array
    {
        return $this->requestedTypes;
    }
}
