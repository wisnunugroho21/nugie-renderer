#pragma once

#include "glfw_window.hpp"
#include "../vulkan_window.hpp"

namespace NugieDisplay {
    class GlfwVulkanWindow : GlfwWindow, VulkanWindow {
    public:
        GlfwVulkanWindow(uint32_t width, uint32_t height, std::string name, VkInstance instance);

        void createWindowSurface(VkInstance instance);
    };
}
