<?php
declare(strict_types=1);

namespace MageOS\ExtensionDirectory\Test\Unit\Fake;

use Magento\Framework\Controller\Result\Redirect;

/**
 * A Redirect result that remembers the path it was pointed at.
 *
 * Every method is overridden and nothing from the parent is read, so this works against the stub
 * and against the framework's own Redirect result.
 */
final class RecordingRedirect extends Redirect
{
    private ?string $recordedPath = null;

    /**
     * @var array<string, mixed>
     */
    private array $recordedParams = [];

    /**
     * Deliberately does not call the parent constructor: there is no URL builder to hand it.
     */
    public function __construct()
    {
    }

    public function setPath($path, array $params = [])
    {
        $this->recordedPath = (string)$path;
        $this->recordedParams = $params;

        return $this;
    }

    public function getPath(): ?string
    {
        return $this->recordedPath;
    }

    /**
     * @return array<string, mixed>
     */
    public function getParams(): array
    {
        return $this->recordedParams;
    }
}
