<?php
declare(strict_types=1);

namespace MageOS\ExtensionDirectory\Test\Unit\Fake;

use MageOS\ExtensionDirectory\Model\Feed\FeedProvider;
use MageOS\ExtensionDirectory\Model\Feed\FeedResult;

/**
 * A feed provider whose answers the test dictates outright.
 *
 * Keeps the controller and view model tests free of cache and HTTP setup, and lets them pin exact
 * fetchedAt timestamps.
 */
final class FakeFeedProvider extends FeedProvider
{
    private ?FeedResult $result = null;

    private ?\Throwable $getError = null;

    /**
     * @var array{fetchedAt: int, feedHash: string}|null
     */
    private ?array $metadata = null;

    private ?\Throwable $peekError = null;

    private int $getCalls = 0;

    private int $peekCalls = 0;

    /**
     * Deliberately does not call the parent constructor: nothing here reaches its collaborators.
     */
    public function __construct()
    {
    }

    public function willReturn(FeedResult $result): self
    {
        $this->result = $result;
        $this->getError = null;

        return $this;
    }

    public function willThrow(\Throwable $error): self
    {
        $this->getError = $error;
        $this->result = null;

        return $this;
    }

    public function withMetadata(int $fetchedAt, string $feedHash = 'cafebabe'): self
    {
        $this->metadata = ['fetchedAt' => $fetchedAt, 'feedHash' => $feedHash];
        $this->peekError = null;

        return $this;
    }

    public function withoutMetadata(): self
    {
        $this->metadata = null;
        $this->peekError = null;

        return $this;
    }

    public function failPeekWith(\Throwable $error): self
    {
        $this->peekError = $error;

        return $this;
    }

    public function getGetCalls(): int
    {
        return $this->getCalls;
    }

    public function getPeekCalls(): int
    {
        return $this->peekCalls;
    }

    public function get(): FeedResult
    {
        $this->getCalls++;
        if ($this->getError !== null) {
            throw $this->getError;
        }
        if ($this->result === null) {
            throw new \LogicException('No feed result was scripted for this test.');
        }

        return $this->result;
    }

    public function peek(): ?array
    {
        $this->peekCalls++;
        if ($this->peekError !== null) {
            throw $this->peekError;
        }

        return $this->metadata;
    }
}
