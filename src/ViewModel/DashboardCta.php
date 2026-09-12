<?php
declare(strict_types=1);

namespace MageOS\ExtensionDirectory\ViewModel;

use MageOS\ExtensionDirectory\Model\Config;
use Magento\Backend\Model\UrlInterface;
use Magento\Framework\Acl\RootResource;
use Magento\Framework\AuthorizationInterface;
use Magento\Framework\View\Element\Block\ArgumentInterface;

/**
 * The dashboard panel that tells an administrator the directory exists.
 *
 * It shows only to accounts whose role allows everything (the ACL root resource): those are the
 * people who decide what gets installed, and a restricted account has no use for a prompt to go
 * find modules. One config flag turns it off for everyone, and the panel's own button flips that
 * same flag, so there is exactly one place the answer lives.
 */
class DashboardCta implements ArgumentInterface
{
    public const DIRECTORY_ROUTE = 'mageos_directory/directory/index';
    public const DISMISS_ROUTE = 'mageos_directory/cta/dismiss';

    public function __construct(
        private readonly Config $config,
        private readonly AuthorizationInterface $authorization,
        private readonly RootResource $rootResource,
        private readonly UrlInterface $backendUrl
    ) {
    }

    /**
     * The config flag is checked first: when the tip is off there is no reason to ask the ACL.
     */
    public function isVisible(): bool
    {
        return $this->config->isDashboardCtaEnabled()
            && $this->authorization->isAllowed($this->rootResource->getId());
    }

    public function getDirectoryUrl(): string
    {
        return $this->backendUrl->getUrl(self::DIRECTORY_ROUTE);
    }

    public function getDismissUrl(): string
    {
        return $this->backendUrl->getUrl(self::DISMISS_ROUTE);
    }
}
