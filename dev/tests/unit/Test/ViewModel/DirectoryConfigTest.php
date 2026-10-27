<?php
declare(strict_types=1);

namespace MageOS\ExtensionDirectory\Test\Unit\ViewModel;

use MageOS\ExtensionDirectory\Model\Config;
use MageOS\ExtensionDirectory\Test\Unit\Fake\ArrayScopeConfig;
use MageOS\ExtensionDirectory\Test\Unit\Fake\FakeAppState;
use MageOS\ExtensionDirectory\Test\Unit\Fake\FakeAssetRepository;
use MageOS\ExtensionDirectory\Test\Unit\Fake\FakeBackendUrl;
use MageOS\ExtensionDirectory\Test\Unit\Fake\FakeFeedProvider;
use MageOS\ExtensionDirectory\Test\Unit\Fake\FakeInstalledPackages;
use MageOS\ExtensionDirectory\Test\Unit\Fake\FakeMageOsProductMetadata;
use MageOS\ExtensionDirectory\Test\Unit\Fake\FakeProductMetadata;
use MageOS\ExtensionDirectory\ViewModel\DirectoryConfig;
use Magento\Framework\App\ProductMetadataInterface;
use Magento\Framework\App\State;
use Magento\Framework\Serialize\Serializer\Json;
use Magento\Framework\View\Element\Block\ArgumentInterface;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

final class DirectoryConfigTest extends TestCase
{
    private const BASE_URL = Config::BASE_URL;
    private const BUNDLE_ASSET_ID = 'MageOS_ExtensionDirectory::js/directory-ui.iife.js';
    private const PROXY_ROUTE = 'mageos_directory/feed/index';

    private const DAY = 86400;

    private FakeBackendUrl $backendUrl;

    private FakeAssetRepository $assetRepository;

    private FakeFeedProvider $feedProvider;

    protected function setUp(): void
    {
        $this->backendUrl = new FakeBackendUrl();
        $this->assetRepository = new FakeAssetRepository();
        $this->feedProvider = new FakeFeedProvider();
    }

    public function testItIsUsableAsABlockArgument(): void
    {
        self::assertInstanceOf(ArgumentInterface::class, $this->viewModel([]));
    }

    public function testTheDirectoryBaseUrlIsHandedToTheTemplateWithoutATrailingSlash(): void
    {
        $baseUrl = $this->viewModel([])->getDirectoryBaseUrl();

        self::assertSame(self::BASE_URL, $baseUrl);
        self::assertSame(rtrim($baseUrl, '/'), $baseUrl);
    }

    public function testProxyModePointsTheBundleAtTheKeyedAdminRoute(): void
    {
        $viewModel = $this->viewModel([Config::XML_PATH_MODE => Config::MODE_PROXY]);

        $mount = $this->decode($viewModel->getMountConfigJson());

        self::assertSame(
            FakeBackendUrl::BASE . self::PROXY_ROUTE . '/key/' . FakeBackendUrl::SECRET_KEY . '/',
            $mount['feedUrl']
        );
        self::assertSame([self::PROXY_ROUTE], $this->backendUrl->getRequestedRoutes());
    }

    public function testDirectModePointsTheBundleAtTheDirectoryOrigin(): void
    {
        $viewModel = $this->viewModel([Config::XML_PATH_MODE => Config::MODE_DIRECT]);

        $mount = $this->decode($viewModel->getMountConfigJson());

        self::assertSame(self::BASE_URL . '/api/v1/feed.json', $mount['feedUrl']);
        self::assertSame([], $this->backendUrl->getRequestedRoutes(), 'Direct mode needs no admin route.');
    }

    public function testTheShippedDefaultIsDirect(): void
    {
        $viewModel = $this->viewModel([]);

        self::assertSame(self::BASE_URL . '/api/v1/feed.json', $this->decode($viewModel->getMountConfigJson())['feedUrl']);
    }

    #[DataProvider('modeProvider')]
    public function testTheBundleIsAlwaysTheModulesOwnCopy(array $settings): void
    {
        $viewModel = $this->viewModel($settings);

        $bundleUrl = $viewModel->getBundleUrl();

        self::assertSame(FakeAssetRepository::STATIC_BASE . 'MageOS_ExtensionDirectory/js/directory-ui.iife.js', $bundleUrl);
        self::assertStringStartsNotWith(self::BASE_URL, $bundleUrl, 'No mode runs script from the directory host.');
        self::assertSame([self::BUNDLE_ASSET_ID], $this->assetRepository->getRequestedAssetIds());
    }

    /**
     * @return array<string, array{array<string, string>}>
     */
    public static function modeProvider(): array
    {
        return [
            'default' => [[]],
            'direct' => [[Config::XML_PATH_MODE => Config::MODE_DIRECT]],
            'proxy' => [[Config::XML_PATH_MODE => Config::MODE_PROXY]],
        ];
    }

    public function testTheMountConfigCarriesTheHandoffContract(): void
    {
        $viewModel = $this->viewModel([], [], new FakeProductMetadata('2.4.7-p3'));

        $mount = $this->decode($viewModel->getMountConfigJson());

        self::assertSame(self::BASE_URL, $mount['baseUrl']);
        self::assertSame('event', $mount['linkMode']);
        self::assertTrue($mount['selectable']);
        self::assertFalse($mount['installCommands'], 'A production admin gets no install commands.');
        self::assertSame('light', $mount['colorScheme'], 'The admin chrome is light-only.');
        self::assertSame('2.4.7-p3', $mount['magentoVersion']);
        self::assertArrayNotHasKey('distribution', $mount, 'Plain Magento is not a distribution.');
    }

    #[DataProvider('installCommandsProvider')]
    public function testInstallCommandsFollowTheSettingAndTheDeployMode(
        ?string $setting,
        string $deployMode,
        bool $expected
    ): void {
        $values = $setting === null ? [] : [Config::XML_PATH_INSTALL_COMMANDS => $setting];
        $viewModel = $this->viewModel($values, [], null, $deployMode);

        self::assertSame($expected, $viewModel->areInstallCommandsShown());
        self::assertSame($expected, $this->decode($viewModel->getMountConfigJson())['installCommands']);
    }

    public static function installCommandsProvider(): array
    {
        return [
            'default, developer mode' => [null, State::MODE_DEVELOPER, true],
            'default, production mode' => [null, State::MODE_PRODUCTION, false],
            'default, default mode' => [null, State::MODE_DEFAULT, false],
            'developer, developer mode' => [Config::INSTALL_COMMANDS_DEVELOPER, State::MODE_DEVELOPER, true],
            'developer, production mode' => [Config::INSTALL_COMMANDS_DEVELOPER, State::MODE_PRODUCTION, false],
            'always, production mode' => [Config::INSTALL_COMMANDS_ALWAYS, State::MODE_PRODUCTION, true],
            'never, developer mode' => [Config::INSTALL_COMMANDS_NEVER, State::MODE_DEVELOPER, false],
        ];
    }

    public function testAMageOsHostSendsBothTheMagentoEquivalentVersionAndItsOwnName(): void
    {
        $viewModel = $this->viewModel([], [], new FakeMageOsProductMetadata('2.4.9', 'Mage-OS', '3.5.0'));

        $mount = $this->decode($viewModel->getMountConfigJson());

        self::assertSame('2.4.9', $mount['magentoVersion']);
        self::assertSame(['name' => 'Mage-OS', 'version' => '3.5.0'], $mount['distribution']);
    }

    public function testTheDistributionIsEmittedAsAJsonObject(): void
    {
        $json = $this->viewModel([], [], new FakeMageOsProductMetadata())->getMountConfigJson();

        $asObjects = json_decode($json);
        self::assertInstanceOf(\stdClass::class, $asObjects->distribution);
        self::assertSame('Mage-OS', $asObjects->distribution->name);
        self::assertSame('3.5.0', $asObjects->distribution->version);
    }

    #[DataProvider('nonReleaseVersionProvider')]
    public function testAVersionThatIsNotAReleaseIsNotSentAtAll(string $version): void
    {
        $json = $this->viewModel([], [], new FakeProductMetadata($version))->getMountConfigJson();

        self::assertStringNotContainsString($version, $json);
        self::assertArrayNotHasKey('magentoVersion', $this->decode($json));
    }

    #[DataProvider('nonReleaseVersionProvider')]
    public function testADistributionIsNotSentWithoutAUsableMagentoVersion(string $version): void
    {
        $viewModel = $this->viewModel([], [], new FakeMageOsProductMetadata($version, 'Mage-OS', '3.5.0'));

        $mount = $this->decode($viewModel->getMountConfigJson());

        self::assertArrayNotHasKey('magentoVersion', $mount);
        self::assertArrayNotHasKey('distribution', $mount, 'The version is the anchor for the label.');
    }

    public static function nonReleaseVersionProvider(): array
    {
        return [
            'source install' => ['1.0.0+no-version-set'],
            'unknown' => ['UNKNOWN'],
        ];
    }

    public function testADistributionVersionThatIsNotAReleaseIsDroppedOnItsOwn(): void
    {
        $viewModel = $this->viewModel([], [], new FakeMageOsProductMetadata('2.4.9', 'Mage-OS', 'dev-main'));

        $mount = $this->decode($viewModel->getMountConfigJson());

        self::assertSame('2.4.9', $mount['magentoVersion']);
        self::assertArrayNotHasKey('distribution', $mount);
    }

    public function testAHostThatCallsItselfMagentoIsNotReportedAsADistribution(): void
    {
        $viewModel = $this->viewModel([], [], new FakeMageOsProductMetadata('2.4.9', 'Magento', '2.4.9'));

        $mount = $this->decode($viewModel->getMountConfigJson());

        self::assertSame('2.4.9', $mount['magentoVersion']);
        self::assertArrayNotHasKey('distribution', $mount);
    }

    public function testAnEmptyDistributionNameIsNotReported(): void
    {
        $viewModel = $this->viewModel([], [], new FakeMageOsProductMetadata('2.4.9', '  ', '3.5.0'));

        self::assertArrayNotHasKey('distribution', $this->decode($viewModel->getMountConfigJson()));
    }

    public function testTheInstalledKeyIsOmittedWhenTheShopHasNothingToReport(): void
    {
        $json = $this->viewModel([], [])->getMountConfigJson();

        self::assertStringNotContainsString('installed', $json);
        self::assertArrayNotHasKey('installed', $this->decode($json));
    }

    public function testTheInstalledMapIsEmittedAsAJsonObject(): void
    {
        $installed = ['acme/module-checkout' => '2.1.0', 'magento/framework' => '103.0.7'];

        $json = $this->viewModel([], $installed)->getMountConfigJson();

        self::assertStringContainsString('"installed":{', $json, 'The bundle expects an object, not an array.');
        self::assertSame($installed, $this->decode($json)['installed']);

        $asObjects = json_decode($json);
        self::assertInstanceOf(\stdClass::class, $asObjects);
        self::assertInstanceOf(\stdClass::class, $asObjects->installed);
        self::assertSame('2.1.0', $asObjects->installed->{'acme/module-checkout'});
    }

    public function testNoAngleBracketSurvivesIntoTheEmbeddedJson(): void
    {
        $installed = ['acme/module-<script>' => '1.0.0-<beta>'];

        $json = $this->viewModel([], $installed)->getMountConfigJson();

        self::assertStringNotContainsString('<', $json, 'A "<" would let a value close the script block.');
        self::assertStringContainsString('\\u003C', $json);
        self::assertSame($installed, $this->decode($json)['installed']);
    }

    public function testTheDataAsOfNoticeIsSilentInDirectMode(): void
    {
        $viewModel = $this->viewModel([Config::XML_PATH_MODE => Config::MODE_DIRECT]);
        $this->feedProvider->withMetadata(time() - 10 * self::DAY);

        self::assertNull($viewModel->getDataAsOf());
        self::assertSame(0, $this->feedProvider->getPeekCalls(), 'Direct mode never consults the cache.');
    }

    public function testTheDataAsOfNoticeIsSilentWithNothingCached(): void
    {
        $viewModel = $this->viewModel([Config::XML_PATH_MODE => Config::MODE_PROXY]);
        $this->feedProvider->withoutMetadata();

        self::assertNull($viewModel->getDataAsOf());
        self::assertSame(1, $this->feedProvider->getPeekCalls());
    }

    public function testTheDataAsOfNoticeIsSilentForARecentCopy(): void
    {
        $viewModel = $this->viewModel([Config::XML_PATH_MODE => Config::MODE_PROXY]);
        $this->feedProvider->withMetadata(time() - 3600);

        self::assertNull($viewModel->getDataAsOf());
    }

    public function testTheDataAsOfNoticeIsSilentForAMeaninglessTimestamp(): void
    {
        $viewModel = $this->viewModel([Config::XML_PATH_MODE => Config::MODE_PROXY]);
        $this->feedProvider->withMetadata(0);

        self::assertNull($viewModel->getDataAsOf());
    }

    public function testACopyOlderThanARebuildCycleIsReportedAsAnIsoTimestamp(): void
    {
        $fetchedAt = time() - 3 * self::DAY;
        $viewModel = $this->viewModel([Config::XML_PATH_MODE => Config::MODE_PROXY]);
        $this->feedProvider->withMetadata($fetchedAt);

        $dataAsOf = $viewModel->getDataAsOf();

        self::assertNotNull($dataAsOf);
        self::assertSame($fetchedAt, (new \DateTimeImmutable($dataAsOf))->getTimestamp());
    }

    public function testAMisbehavingCacheDoesNotStopThePageFromRendering(): void
    {
        $viewModel = $this->viewModel([Config::XML_PATH_MODE => Config::MODE_PROXY]);
        $this->feedProvider->failPeekWith(new \RuntimeException('the cache backend is down'));

        self::assertNull($viewModel->getDataAsOf());
    }

    /**
     * @param array<string, mixed> $configValues
     * @param array<string, string> $installed
     */
    private function viewModel(
        array $configValues,
        array $installed = [],
        ?ProductMetadataInterface $productMetadata = null,
        string $deployMode = State::MODE_PRODUCTION
    ): DirectoryConfig {
        return new DirectoryConfig(
            new Config(new ArrayScopeConfig($configValues)),
            $this->feedProvider,
            new FakeInstalledPackages($installed),
            $productMetadata ?? new FakeProductMetadata(),
            $this->backendUrl,
            $this->assetRepository,
            new Json(),
            new FakeAppState($deployMode)
        );
    }

    /**
     * @return array<string, mixed>
     */
    private function decode(string $json): array
    {
        $decoded = json_decode($json, true, 512, JSON_THROW_ON_ERROR);
        self::assertIsArray($decoded);

        return $decoded;
    }
}
