<?php
declare(strict_types=1);

namespace MageOS\ExtensionDirectory\Test\Unit\Fake;

use Magento\Backend\Model\UrlInterface;

/**
 * Builds a keyed admin URL the way the backend URL builder would, and records the routes asked for.
 */
final class FakeBackendUrl implements UrlInterface
{
    public const BASE = 'https://shop.example.com/admin/';

    public const SECRET_KEY = '2f1a9c4d';

    /**
     * @var list<string>
     */
    private array $requestedRoutes = [];

    public function getUrl($routePath = null, $routeParams = null)
    {
        $this->requestedRoutes[] = (string)$routePath;

        return self::BASE . trim((string)$routePath, '/') . '/key/' . self::SECRET_KEY . '/';
    }

    /**
     * @return list<string>
     */
    public function getRequestedRoutes(): array
    {
        return $this->requestedRoutes;
    }
}
