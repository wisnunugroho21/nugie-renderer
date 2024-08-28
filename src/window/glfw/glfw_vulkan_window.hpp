#pragma once

#include "glfw_window.hpp"

namespace NugieDisplay {
    class GlfwVulkanWindow : GlfwWindow {
    public:
        GlfwVulkanWindow(uint32_t width, uint32_t height, std::string name);

        VkSurfaceKHR getSurface() const { return this->surface; }

        void createWindowSurface(VkInstance instance, VkSurfaceKHR *surface);

    private:
        VkSurfaceKHR surface;
    };
}
