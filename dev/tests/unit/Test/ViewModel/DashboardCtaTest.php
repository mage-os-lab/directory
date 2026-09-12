<?php
declare(strict_types=1);

namespace MageOS\ExtensionDirectory\Test\Unit\ViewModel;

use MageOS\ExtensionDirectory\Model\Config;
use MageOS\ExtensionDirectory\Test\Unit\Fake\ArrayScopeConfig;
use MageOS\ExtensionDirectory\Test\Unit\Fake\FakeAuthorization;
use MageOS\ExtensionDirectory\Test\Unit\Fake\FakeBackendUrl;
use MageOS\ExtensionDirectory\ViewModel\DashboardCta;
use Magento\Framework\Acl\RootResource;
use Magento\Framework\View\Element\Block\ArgumentInterface;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

final class DashboardCtaTest extends TestCase
{
    /**
     * What Magento_Backend's di.xml hands the root resource in a real installation.
     */
    private const ROOT_RESOURCE = 'Magento_Backend::all';

    public function testItIsUsableAsABlockArgument(): void
    {
        self::assertInstanceOf(ArgumentInterface::class, $this->viewModel('1', [self::ROOT_RESOURCE]));
    }

    #[DataProvider('visibilityProvider')]
    public function testItShowsOnlyWhenTheTipIsOnAndTheRoleAllowsEverything(
        mixed $flag,
        array $allowed,
        bool $expected
    ): void {
        self::assertSame($expected, $this->viewModel($flag, $allowed)->isVisible());
    }

    public static function visibilityProvider(): array
    {
        return [
            'on, unrestricted admin' => ['1', [self::ROOT_RESOURCE], true],
            'on, restricted admin who can open the directory' => [
                '1',
                ['MageOS_ExtensionDirectory::directory', 'Magento_Config::config_admin'],
                false,
            ],
            'on, restricted admin' => ['1', [], false],
            'off, unrestricted admin' => ['0', [self::ROOT_RESOURCE], false],
            'unset, unrestricted admin' => [null, [self::ROOT_RESOURCE], false],
        ];
    }

    public function testItAsksTheAclForWhateverTheRootResourceIsCalled(): void
    {
        $authorization = new FakeAuthorization(['Acme_Backend::everything']);
        $viewModel = new DashboardCta(
            new Config(new ArrayScopeConfig([Config::XML_PATH_DASHBOARD_CTA => '1'])),
            $authorization,
            new RootResource('Acme_Backend::everything'),
            new FakeBackendUrl()
        );

        self::assertTrue($viewModel->isVisible());
        self::assertSame(['Acme_Backend::everything'], $authorization->getAskedResources());
    }

    public function testItDoesNotConsultTheAclWhenTheTipIsOff(): void
    {
        $authorization = new FakeAuthorization([self::ROOT_RESOURCE]);
        $viewModel = new DashboardCta(
            new Config(new ArrayScopeConfig([Config::XML_PATH_DASHBOARD_CTA => '0'])),
            $authorization,
            new RootResource(self::ROOT_RESOURCE),
            new FakeBackendUrl()
        );

        self::assertFalse($viewModel->isVisible());
        self::assertSame([], $authorization->getAskedResources());
    }

    public function testBothButtonsPointAtKeyedAdminUrls(): void
    {
        $backendUrl = new FakeBackendUrl();
        $viewModel = new DashboardCta(
            new Config(new ArrayScopeConfig([])),
            new FakeAuthorization(),
            new RootResource(self::ROOT_RESOURCE),
            $backendUrl
        );

        self::assertSame(
            FakeBackendUrl::BASE . 'mageos_directory/directory/index/key/' . FakeBackendUrl::SECRET_KEY . '/',
            $viewModel->getDirectoryUrl()
        );
        self::assertSame(
            FakeBackendUrl::BASE . 'mageos_directory/cta/dismiss/key/' . FakeBackendUrl::SECRET_KEY . '/',
            $viewModel->getDismissUrl()
        );
        self::assertSame(
            ['mageos_directory/directory/index', 'mageos_directory/cta/dismiss'],
            $backendUrl->getRequestedRoutes()
        );
    }

    /**
     * @param list<string> $allowed
     */
    private function viewModel(mixed $flag, array $allowed): DashboardCta
    {
        return new DashboardCta(
            new Config(new ArrayScopeConfig([Config::XML_PATH_DASHBOARD_CTA => $flag])),
            new FakeAuthorization($allowed),
            new RootResource(self::ROOT_RESOURCE),
            new FakeBackendUrl()
        );
    }
}
