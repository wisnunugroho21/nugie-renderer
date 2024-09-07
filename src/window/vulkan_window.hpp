#pragma once

#include <vulkan/vulkan.h>
#include "window.hpp"

namespace NugieDisplay {
    class VulkanWindow {
    public:
        VkSurfaceKHR getSurface() const { return this->surface; }

    protected:
        VkSurfaceKHR surface;
    };
}