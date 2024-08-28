#include "glfw_window.hpp"

#include <utility>
#include <stdexcept>

namespace NugieDisplay {
    GlfwWindow::GlfwWindow(uint32_t w, uint32_t h, std::string name) {
        this->width = w;
        this->height = h;
        this->name = std::move(name);

        this->init();
    }

    GlfwWindow::~GlfwWindow() {
        this->destroy();
    }

    void GlfwWindow::init() {
        glfwInit();
        glfwWindowHint(GLFW_CLIENT_API, GLFW_NO_API);
        glfwWindowHint(GLFW_RESIZABLE, GLFW_TRUE);

        this->window = glfwCreateWindow(static_cast<int>(this->width), static_cast<int>(this->height),
                                        this->name.c_str(), nullptr, nullptr);

        glfwSetWindowUserPointer(this->window, this);
        glfwSetFramebufferSizeCallback(this->window, NugieDisplay::GlfwWindow::frameBufferResizedCallback);
    }

    void GlfwWindow::destroy() {
        glfwDestroyWindow(this->window);
        glfwTerminate();
    }

    bool GlfwWindow::shouldClose() {
        return glfwWindowShouldClose(this->window);
    }

    void GlfwWindow::pollEvents() {
        glfwPollEvents();
    }

    void GlfwWindow::resetResizedFlag() {
        this->frameBufferResized = false;
    }

    void GlfwWindow::frameBufferResizedCallback(GLFWwindow *window, int width, int height) {
        auto currentWindow = reinterpret_cast<GlfwWindow*>(glfwGetWindowUserPointer(window));
        currentWindow->frameBufferResized = true;
        currentWindow->width = width;
        currentWindow->height = height;
    }

    int GlfwWindow::convertKeyMaptoGLFW(KeyMap keyMap) {
        switch (keyMap) {
            case KeyMap::KEY_A: return GLFW_KEY_A;
            case KeyMap::KEY_D: return GLFW_KEY_D;
            case KeyMap::KEY_W: return GLFW_KEY_W;
            case KeyMap::KEY_S: return GLFW_KEY_S;
            case KeyMap::KEY_E: return GLFW_KEY_E;
            case KeyMap::KEY_Q: return GLFW_KEY_Q;
            case KeyMap::KEY_LEFT: return GLFW_KEY_LEFT;
            case KeyMap::KEY_RIGHT: return GLFW_KEY_RIGHT;
            case KeyMap::KEY_UP: return GLFW_KEY_UP;
            case KeyMap::KEY_DOWN: return GLFW_KEY_DOWN;
            default: return GLFW_KEY_ENTER;
        }
    }

    void GlfwWindow::setAppTitle(std::string title) {
        glfwSetWindowTitle(this->window, title.c_str());
    }

    bool GlfwWindow::isKeyPressed(KeyMap keyMap) {
        return glfwGetKey(this->window, GlfwWindow::convertKeyMaptoGLFW(keyMap)) == GLFW_PRESS;
    }

    bool GlfwWindow::isKeyReleased(KeyMap keyMap) {
        return glfwGetKey(this->window, GlfwWindow::convertKeyMaptoGLFW(keyMap)) == GLFW_RELEASE;
    }
}