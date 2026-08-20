<?php
declare(strict_types=1);

namespace MageOS\ExtensionDirectory\Test\Unit\Fake;

use MageOS\ExtensionDirectory\Model\Cache\Type as DirectoryCache;

/**
 * The module's cache type backed by an array instead of a cache frontend.
 *
 * It extends the real cache type so the classes under test keep their declared dependency, but it
 * replaces every storage method and skips the parent constructor, which would want a frontend pool.
 */
final class InMemoryCache extends DirectoryCache
{
    /**
     * @var array<string, string>
     */
    private array $entries = [];

    /**
     * @var list<array{id: string, tags: array<int, string>, lifetime: mixed}>
     */
    private array $writes = [];

    /**
     * Deliberately does not call the parent constructor: there is no frontend pool to hand it.
     */
    public function __construct()
    {
    }

    public function save($data, $identifier, array $tags = [], $lifeTime = null)
    {
        $this->entries[(string)$identifier] = (string)$data;
        $this->writes[] = ['id' => (string)$identifier, 'tags' => $tags, 'lifetime' => $lifeTime];

        return true;
    }

    public function load($identifier)
    {
        return $this->entries[(string)$identifier] ?? false;
    }

    public function remove($identifier)
    {
        unset($this->entries[(string)$identifier]);

        return true;
    }

    public function clean($mode = 'all', array $tags = [])
    {
        $this->entries = [];

        return true;
    }

    public function isEmpty(): bool
    {
        return $this->entries === [];
    }

    public function count(): int
    {
        return count($this->entries);
    }

    /**
     * @return list<array{id: string, tags: array<int, string>, lifetime: mixed}>
     */
    public function getWrites(): array
    {
        return $this->writes;
    }

    /**
     * Backdates every stored entry that carries a "fetchedAt" timestamp.
     *
     * Lets a test age the cache past its TTL without knowing which cache ids the code under test
     * uses, and without waiting for the clock.
     */
    public function ageBy(int $seconds): void
    {
        foreach ($this->entries as $identifier => $value) {
            $decoded = json_decode($value, true);
            if (!is_array($decoded) || !isset($decoded['fetchedAt'])) {
                continue;
            }

            $decoded['fetchedAt'] = (int)$decoded['fetchedAt'] - $seconds;
            $this->entries[$identifier] = (string)json_encode($decoded);
        }
    }
}
