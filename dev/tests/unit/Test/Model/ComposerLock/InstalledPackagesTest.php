<?php
declare(strict_types=1);

namespace MageOS\ExtensionDirectory\Test\Unit\Model\ComposerLock;

use MageOS\ExtensionDirectory\Model\Cache\Type as DirectoryCache;
use MageOS\ExtensionDirectory\Model\ComposerLock\InstalledPackages;
use MageOS\ExtensionDirectory\Test\Unit\Fake\CollectingLogger;
use MageOS\ExtensionDirectory\Test\Unit\Fake\FakeDirectoryRead;
use MageOS\ExtensionDirectory\Test\Unit\Fake\FakeFilesystem;
use MageOS\ExtensionDirectory\Test\Unit\Fake\InMemoryCache;
use Magento\Framework\App\Filesystem\DirectoryList;
use PHPUnit\Framework\TestCase;

final class InstalledPackagesTest extends TestCase
{
    private const LOCK_FILE = 'composer.lock';

    private InMemoryCache $cache;

    private CollectingLogger $logger;

    protected function setUp(): void
    {
        $this->cache = new InMemoryCache();
        $this->logger = new CollectingLogger();
    }

    public function testARealisticLockFileBecomesANameToVersionMap(): void
    {
        $read = (new FakeDirectoryRead())->withFile(self::LOCK_FILE, $this->fixture());

        $map = $this->packages($read)->getMap();

        self::assertSame(
            [
                'magento/framework' => '103.0.7',
                'magento/module-backend' => '102.0.7',
                'mage-os/module-extension-directory' => '0.1.0',
                'yireo/magento2-webp2' => '2.1.0',
                'hyva-themes/magento2-theme-module' => '1.3.11',
                'acme/module-nightly' => 'dev-main',
            ],
            $map
        );
    }

    public function testTheLeadingVersionLetterIsStrippedInEitherCase(): void
    {
        $read = (new FakeDirectoryRead())->withFile(self::LOCK_FILE, (string)json_encode([
            'packages' => [
                ['name' => 'acme/lower', 'version' => 'v1.2.3'],
                ['name' => 'acme/upper', 'version' => 'V4.5.6'],
                ['name' => 'acme/none', 'version' => '7.8.9'],
                ['name' => 'acme/inner', 'version' => '1.0.0-vega'],
            ],
        ]));

        self::assertSame(
            [
                'acme/lower' => '1.2.3',
                'acme/upper' => '4.5.6',
                'acme/none' => '7.8.9',
                'acme/inner' => '1.0.0-vega',
            ],
            $this->packages($read)->getMap()
        );
    }

    public function testDevRequirementsAreNotPartOfTheInstalledSet(): void
    {
        $map = $this->packages((new FakeDirectoryRead())->withFile(self::LOCK_FILE, $this->fixture()))->getMap();

        self::assertArrayNotHasKey('phpunit/phpunit', $map);
        self::assertArrayNotHasKey('squizlabs/php_codesniffer', $map);
    }

    public function testEntriesWithoutAUsableNameOrVersionAreSkipped(): void
    {
        $map = $this->packages((new FakeDirectoryRead())->withFile(self::LOCK_FILE, $this->fixture()))->getMap();

        self::assertArrayNotHasKey('acme/module-without-a-version', $map);
        self::assertArrayNotHasKey('acme/module-with-an-empty-version', $map);
        self::assertNotContains('3.0.0', $map, 'An entry without a name has nothing to key on.');
    }

    public function testTheRootDirectoryIsWhereTheLockFileIsLookedFor(): void
    {
        $read = (new FakeDirectoryRead())->withFile(self::LOCK_FILE, $this->fixture());
        $filesystem = new FakeFilesystem($read);

        (new InstalledPackages($filesystem, $this->cache, $this->logger))->getMap();

        self::assertSame([DirectoryList::ROOT], $filesystem->getRequestedDirectoryCodes());
    }

    public function testAMissingLockFileYieldsAnEmptyMap(): void
    {
        $read = new FakeDirectoryRead();

        self::assertSame([], $this->packages($read)->getMap());
        self::assertSame(0, $read->getReadFileCalls());
        self::assertContains(
            'Mage-OS Extension Directory: no composer.lock in the Magento root.',
            $this->logger->getMessages('debug')
        );
    }

    public function testAnInvalidLockFileYieldsAnEmptyMap(): void
    {
        $read = (new FakeDirectoryRead())->withFile(self::LOCK_FILE, '{ this is not json');

        self::assertSame([], $this->packages($read)->getMap());
        self::assertContains(
            'Mage-OS Extension Directory: composer.lock is not valid JSON.',
            $this->logger->getMessages('debug')
        );
    }

    public function testALockFileWithoutAPackagesArrayYieldsAnEmptyMap(): void
    {
        $read = (new FakeDirectoryRead())->withFile(self::LOCK_FILE, '{"packages-dev": []}');

        self::assertSame([], $this->packages($read)->getMap());
    }

    public function testAFailingStatYieldsAnEmptyMap(): void
    {
        $read = (new FakeDirectoryRead())
            ->withFile(self::LOCK_FILE, $this->fixture())
            ->failStatWith(new \RuntimeException('stat: permission denied'));

        self::assertSame([], $this->packages($read)->getMap());
        self::assertContains(
            'Mage-OS Extension Directory: composer.lock could not be read: stat: permission denied',
            $this->logger->getMessages('debug')
        );
    }

    public function testAFailingReadYieldsAnEmptyMap(): void
    {
        $read = (new FakeDirectoryRead())
            ->withFile(self::LOCK_FILE, $this->fixture())
            ->failReadWith(new \RuntimeException('read: input/output error'));

        self::assertSame([], $this->packages($read)->getMap());
        self::assertContains(
            'Mage-OS Extension Directory: composer.lock could not be read: read: input/output error',
            $this->logger->getMessages('debug')
        );
    }

    public function testAnUnchangedLockFileIsParsedOnlyOnce(): void
    {
        $read = (new FakeDirectoryRead())->withFile(self::LOCK_FILE, $this->fixture());
        $packages = $this->packages($read);

        $first = $packages->getMap();
        $second = $packages->getMap();

        self::assertSame($first, $second);
        self::assertSame(1, $read->getReadFileCalls(), 'The second call comes out of the cache.');
        self::assertSame(2, $read->getStatCalls(), 'The cache key is still derived from a fresh stat.');
    }

    public function testTheCachedMapSurvivesAcrossInstancesOfTheReader(): void
    {
        $read = (new FakeDirectoryRead())->withFile(self::LOCK_FILE, $this->fixture());

        $first = $this->packages($read)->getMap();
        $second = $this->packages($read)->getMap();

        self::assertSame($first, $second);
        self::assertSame(1, $read->getReadFileCalls());
    }

    public function testATouchedLockFileIsParsedAgain(): void
    {
        $read = (new FakeDirectoryRead())->withFile(self::LOCK_FILE, $this->fixture(), 1755648000);
        $packages = $this->packages($read);

        $packages->getMap();
        $read->touchFile(self::LOCK_FILE, 1755734400);
        $packages->getMap();

        self::assertSame(2, $read->getReadFileCalls(), 'A new mtime means a new cache key.');
    }

    public function testAChangedLockFileIsReflectedInTheMap(): void
    {
        $read = (new FakeDirectoryRead())
            ->withFile(self::LOCK_FILE, (string)json_encode(['packages' => [
                ['name' => 'acme/module-one', 'version' => 'v1.0.0'],
            ]]), 1755648000);
        $packages = $this->packages($read);

        self::assertSame(['acme/module-one' => '1.0.0'], $packages->getMap());

        $read->withFile(self::LOCK_FILE, (string)json_encode(['packages' => [
            ['name' => 'acme/module-one', 'version' => 'v1.1.0'],
            ['name' => 'acme/module-two', 'version' => '2.0.0'],
        ]]), 1755734400);

        self::assertSame(
            ['acme/module-one' => '1.1.0', 'acme/module-two' => '2.0.0'],
            $packages->getMap()
        );
    }

    public function testTheCachedMapCarriesTheModuleTag(): void
    {
        $this->packages((new FakeDirectoryRead())->withFile(self::LOCK_FILE, $this->fixture()))->getMap();

        $writes = $this->cache->getWrites();

        self::assertCount(1, $writes);
        self::assertSame([DirectoryCache::CACHE_TAG], $writes[0]['tags']);
        self::assertGreaterThan(0, $writes[0]['lifetime']);
    }

    private function packages(FakeDirectoryRead $read): InstalledPackages
    {
        return new InstalledPackages(new FakeFilesystem($read), $this->cache, $this->logger);
    }

    private function fixture(): string
    {
        return (string)file_get_contents(__DIR__ . '/../../_files/composer.lock.json');
    }
}
