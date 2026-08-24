<?php
declare(strict_types=1);

namespace MageOS\ExtensionDirectory\Test\Unit\Fake;

use Psr\Log\LoggerInterface;

/**
 * Logger that keeps every record so a test can assert a fallback was reported rather than silent.
 */
final class CollectingLogger implements LoggerInterface
{
    /**
     * @var list<array{level: string, message: string}>
     */
    private array $records = [];

    /**
     * @return list<array{level: string, message: string}>
     */
    public function getRecords(): array
    {
        return $this->records;
    }

    /**
     * @return list<string>
     */
    public function getMessages(?string $level = null): array
    {
        $messages = [];
        foreach ($this->records as $record) {
            if ($level === null || $record['level'] === $level) {
                $messages[] = $record['message'];
            }
        }

        return $messages;
    }

    public function emergency($message, array $context = []): void
    {
        $this->log('emergency', $message, $context);
    }

    public function alert($message, array $context = []): void
    {
        $this->log('alert', $message, $context);
    }

    public function critical($message, array $context = []): void
    {
        $this->log('critical', $message, $context);
    }

    public function error($message, array $context = []): void
    {
        $this->log('error', $message, $context);
    }

    public function warning($message, array $context = []): void
    {
        $this->log('warning', $message, $context);
    }

    public function notice($message, array $context = []): void
    {
        $this->log('notice', $message, $context);
    }

    public function info($message, array $context = []): void
    {
        $this->log('info', $message, $context);
    }

    public function debug($message, array $context = []): void
    {
        $this->log('debug', $message, $context);
    }

    public function log($level, $message, array $context = []): void
    {
        $this->records[] = ['level' => (string)$level, 'message' => (string)$message];
    }
}
