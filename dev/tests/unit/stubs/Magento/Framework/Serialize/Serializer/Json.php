<?php
declare(strict_types=1);

namespace Magento\Framework\Serialize\Serializer;

if (!class_exists(Json::class)) {
    /**
     * Test stub for Magento\Framework\Serialize\Serializer\Json.
     *
     * Mirrors the real implementation: plain json_encode/json_decode with no extra flags (so "/"
     * still comes out escaped as "\/"), and an InvalidArgumentException on failure.
     */
    class Json
    {
        public function serialize($data)
        {
            $result = json_encode($data);
            if ($result === false) {
                throw new \InvalidArgumentException('Unable to serialize value. Error: ' . json_last_error_msg());
            }

            return $result;
        }

        public function unserialize($string)
        {
            $result = json_decode($string, true);
            if (json_last_error() !== JSON_ERROR_NONE) {
                throw new \InvalidArgumentException('Unable to unserialize value. Error: ' . json_last_error_msg());
            }

            return $result;
        }
    }
}
