<?php
declare(strict_types=1);

namespace MageOS\ExtensionDirectory\Test\Unit\Fake;

use Magento\Framework\HTTP\ClientInterface;

/**
 * A single scripted request, handed out by ScriptedHttpClientFactory.
 */
final class ScriptedHttpClient implements ClientInterface
{
    private ScriptedHttpClientFactory $factory;

    private int $status = 0;

    private string $body = '';

    public function __construct(ScriptedHttpClientFactory $factory)
    {
        $this->factory = $factory;
    }

    public function setTimeout($value)
    {
        $this->factory->recordTimeout((int)$value);
    }

    public function get($uri)
    {
        $response = $this->factory->play((string)$uri);
        $this->status = $response['status'];
        $this->body = $response['body'];
    }

    public function getStatus()
    {
        return $this->status;
    }

    public function getBody()
    {
        return $this->body;
    }
}
