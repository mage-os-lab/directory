<?php
declare(strict_types=1);

namespace MageOS\ExtensionDirectory\Test\Unit\Fake;

use Magento\Framework\Message\ManagerInterface;

/**
 * Keeps the messages a controller adds, by kind, as plain strings.
 */
final class CollectingMessageManager implements ManagerInterface
{
    /**
     * @var list<array{kind: string, text: string}>
     */
    private array $messages = [];

    public function addSuccessMessage($message, $group = null)
    {
        $this->messages[] = ['kind' => 'success', 'text' => (string)$message];

        return $this;
    }

    public function addNoticeMessage($message, $group = null)
    {
        $this->messages[] = ['kind' => 'notice', 'text' => (string)$message];

        return $this;
    }

    /**
     * @return list<string>
     */
    public function getSuccessMessages(): array
    {
        return array_values(array_map(
            static fn (array $message): string => $message['text'],
            array_filter($this->messages, static fn (array $message): bool => $message['kind'] === 'success')
        ));
    }

    /**
     * @return list<array{kind: string, text: string}>
     */
    public function getMessages(): array
    {
        return $this->messages;
    }
}
