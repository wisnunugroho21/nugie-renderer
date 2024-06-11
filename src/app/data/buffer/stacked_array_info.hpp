#pragma once

#include <string>
#include "../../../vulkan/device/device.hpp"

namespace NugieApp {
    struct ArrayItemInfo {
        std::string arrayId;
        VkDeviceSize instanceSize = 0u;
        uint32_t count = 0u;
    };

    struct ArrayItemBufferInfo {
        VkDeviceSize size = 0u;
        VkDeviceSize offset = 0u;
    };
}