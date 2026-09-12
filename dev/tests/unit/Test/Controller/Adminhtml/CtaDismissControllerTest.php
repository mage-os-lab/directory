<?php
declare(strict_types=1);

namespace MageOS\ExtensionDirectory\Test\Unit\Controller\Adminhtml;

use MageOS\ExtensionDirectory\Controller\Adminhtml\Cta\Dismiss as DismissController;
use MageOS\ExtensionDirectory\Model\Config;
use MageOS\ExtensionDirectory\Test\Unit\Fake\CollectingMessageManager;
use MageOS\ExtensionDirectory\Test\Unit\Fake\FakeReinitableConfig;
use MageOS\ExtensionDirectory\Test\Unit\Fake\FakeResultFactory;
use MageOS\ExtensionDirectory\Test\Unit\Fake\RecordingConfigWriter;
use MageOS\ExtensionDirectory\Test\Unit\Fake\RecordingRedirect;
use Magento\Backend\App\Action\Context;
use Magento\Framework\App\Action\HttpPostActionInterface;
use Magento\Framework\Controller\ResultFactory;
use PHPUnit\Framework\TestCase;

final class CtaDismissControllerTest extends TestCase
{
    private FakeResultFactory $resultFactory;

    private RecordingConfigWriter $configWriter;

    private FakeReinitableConfig $reinitableConfig;

    private CollectingMessageManager $messageManager;

    protected function setUp(): void
    {
        $this->resultFactory = new FakeResultFactory();
        $this->configWriter = new RecordingConfigWriter();
        $this->reinitableConfig = new FakeReinitableConfig();
        $this->messageManager = new CollectingMessageManager();
    }

    public function testItTurnsTheTipOffForEveryoneInTheDefaultScope(): void
    {
        $this->execute();

        self::assertSame(
            [
                [
                    'op' => 'save',
                    'path' => Config::XML_PATH_DASHBOARD_CTA,
                    'value' => 0,
                    'scope' => 'default',
                    'scopeId' => 0,
                ],
            ],
            $this->configWriter->getWrites()
        );
    }

    public function testItReloadsConfigAfterTheSaveSoTheNextPageSeesTheChange(): void
    {
        $writesSeenAtReinit = null;
        $this->reinitableConfig->onReinit(function () use (&$writesSeenAtReinit): void {
            $writesSeenAtReinit = count($this->configWriter->getWrites());
        });

        $this->execute();

        self::assertSame(1, $this->reinitableConfig->getReinitCount());
        self::assertSame(1, $writesSeenAtReinit, 'Reinitialising before the save would reload the old flag.');
    }

    public function testItTellsTheAdminWhereToTurnTheTipBackOn(): void
    {
        $this->execute();

        $messages = $this->messageManager->getSuccessMessages();
        self::assertCount(1, $messages);
        self::assertStringContainsString('hidden', $messages[0]);
        self::assertStringContainsString('Stores > Configuration > Advanced > Admin > Dashboard', $messages[0]);
    }

    public function testItSendsTheAdminBackToTheDashboard(): void
    {
        $redirect = $this->execute();

        self::assertSame('adminhtml/dashboard/index', $redirect->getPath());
        self::assertSame([], $redirect->getParams());
        self::assertSame([ResultFactory::TYPE_REDIRECT], $this->resultFactory->getRequestedTypes());
    }

    /**
     * Hiding the panel edits a setting in the core Admin configuration section, so it needs that
     * section's permission, and it changes state, so it only answers a POST (which the base
     * action form-key-checks).
     */
    public function testItIsAnAdminConfigPostAction(): void
    {
        self::assertSame('Magento_Config::config_admin', DismissController::ADMIN_RESOURCE);
        self::assertInstanceOf(HttpPostActionInterface::class, $this->controller());
    }

    private function execute(): RecordingRedirect
    {
        $result = $this->controller()->execute();

        self::assertSame($this->resultFactory->getRedirect(), $result);

        return $this->resultFactory->getRedirect();
    }

    private function controller(): DismissController
    {
        return new DismissController(
            new Context($this->resultFactory, $this->messageManager),
            $this->configWriter,
            $this->reinitableConfig
        );
    }
}
