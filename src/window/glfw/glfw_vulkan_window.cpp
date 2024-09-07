#include "glfw_vulkan_window.hpp"

#include <utility>

namespace NugieDisplay {
    GlfwVulkanWindow::GlfwVulkanWindow(uint32_t w, uint32_t h, std::string name, VkInstance instance) : GlfwWindow(w, h, name) {
        this->createWindowSurface(instance);
    }

    void GlfwVulkanWindow::createWindowSurface(VkInstance instance) {
        if (glfwCreateWindowSurface(instance, this->window, nullptr, &this->surface) != VK_SUCCESS) {
            throw std::runtime_error("failed to create window surface");
        }
    }
}