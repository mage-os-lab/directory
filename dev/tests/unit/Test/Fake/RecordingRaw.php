<?php
declare(strict_types=1);

namespace MageOS\ExtensionDirectory\Test\Unit\Fake;

use Magento\Framework\Controller\Result\Raw;

/**
 * A Raw result that remembers what the controller put on it.
 *
 * Every method is overridden and nothing from the parent is read, so this works against the stub
 * and against the framework's own Raw result.
 */
final class RecordingRaw extends Raw
{
    /**
     * PHP's default when a controller never sets one.
     */
    private int $httpResponseCode = 200;

    private ?string $body = null;

    /**
     * @var array<string, array{value: string, replace: bool}>
     */
    private array $recordedHeaders = [];

    public function setContents($contents)
    {
        $this->body = (string)$contents;

        return $this;
    }

    public function setHttpResponseCode($httpCode)
    {
        $this->httpResponseCode = (int)$httpCode;

        return $this;
    }

    public function setHeader($name, $value, $replace = false)
    {
        $this->recordedHeaders[(string)$name] = ['value' => (string)$value, 'replace' => (bool)$replace];

        return $this;
    }

    public function getHttpResponseCode(): int
    {
        return $this->httpResponseCode;
    }

    public function getBody(): ?string
    {
        return $this->body;
    }

    public function getHeader(string $name): ?string
    {
        return $this->recordedHeaders[$name]['value'] ?? null;
    }

    public function isHeaderReplacing(string $name): ?bool
    {
        return isset($this->recordedHeaders[$name]) ? $this->recordedHeaders[$name]['replace'] : null;
    }

    /**
     * @return list<string>
     */
    public function getHeaderNames(): array
    {
        return array_keys($this->recordedHeaders);
    }

    /**
     * @return array<string, mixed>
     */
    public function getDecodedBody(): array
    {
        $decoded = json_decode((string)$this->body, true);

        return is_array($decoded) ? $decoded : [];
    }
}
