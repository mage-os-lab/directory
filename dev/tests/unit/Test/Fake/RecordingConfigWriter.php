<?php
declare(strict_types=1);

namespace MageOS\ExtensionDirectory\Test\Unit\Fake;

use Magento\Framework\App\Config\ScopeConfigInterface;
use Magento\Framework\App\Config\Storage\WriterInterface;

/**
 * Remembers every save and delete, in order, with the scope it was asked for.
 */
final class RecordingConfigWriter implements WriterInterface
{
    /**
     * @var list<array{op: string, path: string, value: mixed, scope: string, scopeId: int}>
     */
    private array $writes = [];

    public function save($path, $value, $scope = ScopeConfigInterface::SCOPE_TYPE_DEFAULT, $scopeId = 0)
    {
        $this->writes[] = [
            'op' => 'save',
            'path' => (string)$path,
            'value' => $value,
            'scope' => (string)$scope,
            'scopeId' => (int)$scopeId,
        ];
    }

    public function delete($path, $scope = ScopeConfigInterface::SCOPE_TYPE_DEFAULT, $scopeId = 0)
    {
        $this->writes[] = [
            'op' => 'delete',
            'path' => (string)$path,
            'value' => null,
            'scope' => (string)$scope,
            'scopeId' => (int)$scopeId,
        ];
    }

    /**
     * @return list<array{op: string, path: string, value: mixed, scope: string, scopeId: int}>
     */
    public function getWrites(): array
    {
        return $this->writes;
    }
}
