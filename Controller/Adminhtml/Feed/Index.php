<?php
declare(strict_types=1);

namespace MageOS\ExtensionDirectory\Controller\Adminhtml\Feed;

use MageOS\ExtensionDirectory\Model\Config;
use MageOS\ExtensionDirectory\Model\Feed\FeedProvider;
use MageOS\ExtensionDirectory\Model\Feed\FeedUnavailableException;
use Magento\Backend\App\Action;
use Magento\Backend\App\Action\Context;
use Magento\Framework\App\Action\HttpGetActionInterface;
use Magento\Framework\Controller\Result\Raw;
use Magento\Framework\Controller\ResultFactory;
use Magento\Framework\Controller\ResultInterface;

/**
 * Same-origin proxy for the directory feed, called only by the directory admin page.
 */
class Index extends Action implements HttpGetActionInterface
{
    public const ADMIN_RESOURCE = 'MageOS_ExtensionDirectory::directory';

    public function __construct(
        Context $context,
        private readonly Config $config,
        private readonly FeedProvider $feedProvider
    ) {
        parent::__construct($context);
    }

    public function execute(): ResultInterface
    {
        /** @var Raw $result */
        $result = $this->resultFactory->create(ResultFactory::TYPE_RAW);
        $result->setHeader('Content-Type', 'application/json', true);
        // The body already comes out of Magento's cache; letting the browser cache it on top of
        // that would hide the staleness signalled below.
        $result->setHeader('Cache-Control', 'private, max-age=0, no-store', true);

        if (!$this->config->isEnabled()) {
            $result->setHttpResponseCode(503);

            return $result->setContents(
                (string)json_encode(['error' => (string)__('The extension directory is disabled.')])
            );
        }

        try {
            $feed = $this->feedProvider->get();
        } catch (FeedUnavailableException $e) {
            // The bundle renders its own retryable error state from any non-OK response.
            $result->setHttpResponseCode(503);

            return $result->setContents((string)json_encode(['error' => $e->getMessage()]));
        }

        $result->setHeader('X-MageOS-Directory-Data-As-Of', gmdate(DATE_ATOM, $feed->getFetchedAt()), true);
        if ($feed->isStale()) {
            $result->setHeader('X-MageOS-Directory-Stale', '1', true);
        }

        // Passed through as fetched — decoding and re-encoding ~1.7 MB of JSON buys nothing.
        return $result->setContents($feed->getBody());
    }
}
