<?php
declare(strict_types=1);

namespace MageOS\ExtensionDirectory\Test\Unit\Fake;

use Magento\Framework\App\Config\ScopeConfigInterface;

/**
 * Scope config backed by a plain path => value array.
 */
final class ArrayScopeConfig implements ScopeConfigInterface
{
    /**
     * @var array<string, mixed>
     */
    private array $values;

    /**
     * @param array<string, mixed> $values
     */
    public function __construct(array $values = [])
    {
        $this->values = $values;
    }

    public function set(string $path, $value): void
    {
        $this->values[$path] = $value;
    }

    public function getValue($path = null, $scopeType = self::SCOPE_TYPE_DEFAULT, $scopeCode = null)
    {
        return $this->values[(string)$path] ?? null;
    }

    public function isSetFlag($path, $scopeType = self::SCOPE_TYPE_DEFAULT, $scopeCode = null)
    {
        $value = $this->values[(string)$path] ?? null;

        // Mirrors Magento: the stored value is a config string, and "0"/""/null are all falsy.
        return !empty($value) && $value !== '0';
    }
}
