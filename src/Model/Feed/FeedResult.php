<?php
declare(strict_types=1);

namespace MageOS\ExtensionDirectory\Model\Feed;

/**
 * The feed as raw JSON plus the freshness metadata the admin page and proxy headers report.
 */
final class FeedResult
{
    public function __construct(
        private readonly string $body,
        private readonly int $fetchedAt,
        private readonly bool $stale
    ) {
    }

    public function getBody(): string
    {
        return $this->body;
    }

    public function getFetchedAt(): int
    {
        return $this->fetchedAt;
    }

    public function isStale(): bool
    {
        return $this->stale;
    }
}
