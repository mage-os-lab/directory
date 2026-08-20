<?php
declare(strict_types=1);

namespace MageOS\ExtensionDirectory\Test\Unit\Fake;

use Magento\Framework\Filesystem\Directory\ReadInterface;

/**
 * A directory read whose contents are declared by the test, with call counting and failure modes.
 */
final class FakeDirectoryRead implements ReadInterface
{
    /**
     * @var array<string, array{contents: string, mtime: int, size: int}>
     */
    private array $files = [];

    private ?\Throwable $statError = null;

    private ?\Throwable $readError = null;

    private int $readFileCalls = 0;

    private int $statCalls = 0;

    public function withFile(string $path, string $contents, int $mtime = 1755648000): self
    {
        $this->files[$path] = ['contents' => $contents, 'mtime' => $mtime, 'size' => strlen($contents)];

        return $this;
    }

    public function touchFile(string $path, int $mtime): void
    {
        if (isset($this->files[$path])) {
            $this->files[$path]['mtime'] = $mtime;
        }
    }

    public function failStatWith(\Throwable $error): self
    {
        $this->statError = $error;

        return $this;
    }

    public function failReadWith(\Throwable $error): self
    {
        $this->readError = $error;

        return $this;
    }

    public function getReadFileCalls(): int
    {
        return $this->readFileCalls;
    }

    public function getStatCalls(): int
    {
        return $this->statCalls;
    }

    public function isFile($path)
    {
        return isset($this->files[(string)$path]);
    }

    public function stat($path)
    {
        $this->statCalls++;
        if ($this->statError !== null) {
            throw $this->statError;
        }

        $file = $this->files[(string)$path] ?? null;
        if ($file === null) {
            throw new \RuntimeException(sprintf('The file "%s" does not exist.', (string)$path));
        }

        return ['mtime' => $file['mtime'], 'size' => $file['size']];
    }

    public function readFile($path, $flag = null, $context = null)
    {
        $this->readFileCalls++;
        if ($this->readError !== null) {
            throw $this->readError;
        }

        $file = $this->files[(string)$path] ?? null;
        if ($file === null) {
            throw new \RuntimeException(sprintf('The file "%s" does not exist.', (string)$path));
        }

        return $file['contents'];
    }
}
