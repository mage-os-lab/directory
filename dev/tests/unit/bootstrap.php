<?php
/**
 * Bootstrap for the hermetic unit suite.
 *
 * The module requires magento/framework, which lives behind repo.magento.com credentials, so the
 * suite never loads it: dev/tests/unit/stubs holds guarded stand-ins for exactly the framework
 * symbols the module touches. Every stub checks class_exists()/interface_exists() first, so inside
 * a real Magento installation the framework's own classes are found by the composer autoloader and
 * the stubs decline to declare anything.
 */
declare(strict_types=1);

$repositoryRoot = dirname(__DIR__, 3);
$stubDirectory = __DIR__ . '/stubs';

$autoloader = $repositoryRoot . '/vendor/autoload.php';
if (!is_file($autoloader)) {
    fwrite(
        STDERR,
        'The unit suite needs PHPUnit. Run: composer install --working-dir=dev/tests/unit' . PHP_EOL
    );
    exit(1);
}
require $autoloader;

/**
 * Module and test classes.
 *
 * composer.json maps both namespaces (autoload / autoload-dev), but the toolchain manifest in this
 * directory installs PHPUnit on its own, so the generated autoloader does not always carry them.
 * Registering them here keeps the suite runnable either way, and keeps test classes out of the
 * production autoloader.
 */
spl_autoload_register(static function (string $class) use ($repositoryRoot): void {
    $prefixes = [
        'MageOS\\ExtensionDirectory\\Test\\Unit\\' => __DIR__ . '/Test/',
        'MageOS\\ExtensionDirectory\\' => $repositoryRoot . '/src/',
    ];

    foreach ($prefixes as $prefix => $baseDirectory) {
        if (strncmp($class, $prefix, strlen($prefix)) !== 0) {
            continue;
        }

        $file = $baseDirectory . str_replace('\\', '/', substr($class, strlen($prefix))) . '.php';
        if (is_file($file)) {
            require_once $file;

            return;
        }
    }
});

/**
 * Framework stubs, registered last so the composer autoloader — and therefore a real Magento
 * installation — always gets first refusal on a Magento or PSR class.
 */
spl_autoload_register(static function (string $class) use ($stubDirectory): void {
    if (strncmp($class, 'Magento\\', 8) !== 0 && strncmp($class, 'Psr\\', 4) !== 0) {
        return;
    }

    $file = $stubDirectory . '/' . str_replace('\\', '/', $class) . '.php';
    if (is_file($file)) {
        require_once $file;
    }
});

// __() is a function, so no autoloader can ever reach it.
require_once $stubDirectory . '/functions.php';

// Loading every stub up front keeps one that nothing happens to reference from rotting unnoticed;
// each file guards its own declaration, so this is a no-op inside a real Magento installation.
$stubFiles = [];
$directoryIterator = new RecursiveIteratorIterator(
    new RecursiveDirectoryIterator($stubDirectory, FilesystemIterator::SKIP_DOTS)
);
foreach ($directoryIterator as $stubFile) {
    if ($stubFile->isFile() && $stubFile->getExtension() === 'php') {
        $stubFiles[] = $stubFile->getPathname();
    }
}
sort($stubFiles);
foreach ($stubFiles as $stubFile) {
    require_once $stubFile;
}
