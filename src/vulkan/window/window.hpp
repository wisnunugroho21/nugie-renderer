#pragma once

#define GLFW_INCLUDE_VULKAN

#include <GLFW/glfw3.h>

#include <string>
#include <stdexcept>

namespace NugieVulkan {
    class Window {
    public:
        Window(uint32_t w, uint32_t h, std::string name);

        ~Window();

        GLFWwindow *getWindow() const { return this->window; }

        bool wasResized() const { return this->frameBufferResized; }

        VkExtent2D getExtent() const {
            return {static_cast<uint32_t>(this->width), static_cast<uint32_t>(this->height)};
        }

        bool shouldClose();

        void resetResizedFlag();

        void createWindowSurface(VkInstance instance, VkSurfaceKHR *surface);

        static void pollEvents();

    private:
        GLFWwindow *window = nullptr;
        bool frameBufferResized = false;

        uint32_t width, height;
        std::string name;

        void init();

        void destroy();

        static void frameBufferResizedCallback(GLFWwindow *window, int width, int height);
    };
}
