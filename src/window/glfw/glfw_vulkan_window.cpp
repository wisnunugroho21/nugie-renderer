#include "glfw_vulkan_window.hpp"

#include <utility>

namespace NugieDisplay {
    GlfwVulkanWindow::GlfwVulkanWindow(uint32_t w, uint32_t h, std::string name) : GlfwWindow(w, h, name) {}

    void GlfwVulkanWindow::createWindowSurface(VkInstance instance, VkSurfaceKHR *surface) {
        if (glfwCreateWindowSurface(instance, this->window, nullptr, &this->surface) != VK_SUCCESS) {
            throw std::runtime_error("failed to create window surface");
        }

        *surface = this->surface;
    }
}