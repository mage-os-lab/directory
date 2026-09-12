<?php
declare(strict_types=1);

namespace MageOS\ExtensionDirectory\Test\Unit\Fake;

use Magento\Framework\App\Config\ReinitableConfigInterface;

/**
 * A reinitable config that only counts how often it was told to reinitialise, and lets a test
 * observe what else had happened by then.
 */
final class FakeReinitableConfig implements ReinitableConfigInterface
{
    private int $reinitCount = 0;

    /**
     * @var callable|null
     */
    private $onReinit;

    public function onReinit(callable $callback): void
    {
        $this->onReinit = $callback;
    }

    public function reinit()
    {
        $this->reinitCount++;
        if ($this->onReinit !== null) {
            ($this->onReinit)();
        }

        return $this;
    }

    public function getReinitCount(): int
    {
        return $this->reinitCount;
    }

    public function getValue($path = null, $scopeType = self::SCOPE_TYPE_DEFAULT, $scopeCode = null)
    {
        return null;
    }

    public function isSetFlag($path, $scopeType = self::SCOPE_TYPE_DEFAULT, $scopeCode = null)
    {
        return false;
    }

    public function setValue($path, $value, $scopeType = self::SCOPE_TYPE_DEFAULT, $scopeCode = null)
    {
    }
}
