<?php
declare(strict_types=1);

namespace MageOS\ExtensionDirectory\Controller\Adminhtml\Cta;

use MageOS\ExtensionDirectory\Model\Config;
use Magento\Backend\App\Action;
use Magento\Framework\App\Action\HttpPostActionInterface;
use Magento\Framework\App\Config\ReinitableConfigInterface;
use Magento\Framework\App\Config\Storage\WriterInterface;
use Magento\Framework\Controller\Result\Redirect;
use Magento\Framework\Controller\ResultFactory;
use Magento\Framework\Controller\ResultInterface;

/**
 * "Hide this tip" on the dashboard panel: turns the panel's config flag off for everyone.
 *
 * Hiding the panel is the same act as unticking its setting, so it asks for the same permission
 * — the setting lives in the core Admin configuration section — and being a POST action the
 * base class checks the form key before this runs.
 */
class Dismiss extends Action implements HttpPostActionInterface
{
    public const ADMIN_RESOURCE = 'Magento_Config::config_admin';

    private const DASHBOARD_ROUTE = 'adminhtml/dashboard/index';

    public function __construct(
        Action\Context $context,
        private readonly WriterInterface $configWriter,
        private readonly ReinitableConfigInterface $reinitableConfig
    ) {
        parent::__construct($context);
    }

    public function execute(): ResultInterface
    {
        $this->configWriter->save(Config::XML_PATH_DASHBOARD_CTA, 0);
        // The config cache still holds the old flag; without this the panel outlives its own button.
        $this->reinitableConfig->reinit();

        $this->messageManager->addSuccessMessage(
            __('The directory tip is hidden. Turn it back on under Stores > Configuration > Advanced > Admin > Dashboard.')
        );

        /** @var Redirect $redirect */
        $redirect = $this->resultFactory->create(ResultFactory::TYPE_REDIRECT);

        return $redirect->setPath(self::DASHBOARD_ROUTE);
    }
}
