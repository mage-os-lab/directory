<?php
declare(strict_types=1);

namespace MageOS\ExtensionDirectory\Test\Unit\Fake;

use Magento\Framework\HTTP\ClientFactory;
use Magento\Framework\HTTP\ClientInterface;

/**
 * HTTP client factory that plays scripted responses and records every request.
 *
 * The feed provider creates a fresh client per request, so the script and the recording live on the
 * factory. A URL nobody scripted answers with HTTP 0 and an empty body: the request is still
 * recorded, so the assertions on the requested URLs report it loudly.
 */
final class ScriptedHttpClientFactory extends ClientFactory
{
    /**
     * @var array<string, array{status: int, body: string}|\Throwable>
     */
    private array $script = [];

    /**
     * @var list<string>
     */
    private array $requestedUrls = [];

    /**
     * @var list<int>
     */
    private array $timeouts = [];

    /**
     * Deliberately does not call the parent constructor: there is no object manager to hand it.
     */
    public function __construct()
    {
    }

    public function create(array $data = []): ClientInterface
    {
        return new ScriptedHttpClient($this);
    }

    public function respondWith(string $url, int $status, string $body): void
    {
        $this->script[$url] = ['status' => $status, 'body' => $body];
    }

    public function failWith(string $url, \Throwable $error): void
    {
        $this->script[$url] = $error;
    }

    /**
     * @return list<string>
     */
    public function getRequestedUrls(): array
    {
        return $this->requestedUrls;
    }

    /**
     * @return list<int>
     */
    public function getTimeouts(): array
    {
        return $this->timeouts;
    }

    public function forgetRequests(): void
    {
        $this->requestedUrls = [];
        $this->timeouts = [];
    }

    public function recordTimeout(int $timeout): void
    {
        $this->timeouts[] = $timeout;
    }

    /**
     * @return array{status: int, body: string}
     */
    public function play(string $url): array
    {
        $this->requestedUrls[] = $url;

        $scripted = $this->script[$url] ?? null;
        if ($scripted instanceof \Throwable) {
            throw $scripted;
        }

        return $scripted ?? ['status' => 0, 'body' => ''];
    }
}
