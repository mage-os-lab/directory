<?php
declare(strict_types=1);

namespace Magento\Framework\Acl;

if (!class_exists(RootResource::class)) {
    /**
     * Test stub for Magento\Framework\Acl\RootResource.
     *
     * In a Magento installation the identifier is injected from Magento_Backend's di.xml as
     * "Magento_Backend::all"; here each test says which id it hands out.
     */
    class RootResource
    {
        /**
         * @var string
         */
        protected $_identifier;

        public function __construct($identifier)
        {
            $this->_identifier = $identifier;
        }

        public function getId()
        {
            return $this->_identifier;
        }
    }
}
