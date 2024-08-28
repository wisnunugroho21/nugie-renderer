#pragma once

#define GLFW_INCLUDE_VULKAN
#include <GLFW/glfw3.h>

#include "../main/window.hpp"


namespace NugieDisplay {
    class GlfwWindow : public Window {
    public:
        GlfwWindow(uint32_t width, uint32_t height, std::string name = "");

        ~GlfwWindow();

        void setAppTitle(std::string title) override;

        void resetResizedFlag() override;

        bool shouldClose() override;

        bool isKeyPressed(KeyMap keyMap) override;

        bool isKeyReleased(KeyMap keyMap) override;

        void pollEvents() override;

    protected:
        GLFWwindow *window = nullptr;

    private:
        void init();

        void destroy();

        static void frameBufferResizedCallback(GLFWwindow *window, int width, int height);

        static int convertKeyMaptoGLFW(KeyMap keyMap);
    };
}
