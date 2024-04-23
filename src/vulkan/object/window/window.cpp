#include "window.hpp"

namespace NugieVulkan {
  Window::Window(uint32_t w, uint32_t h, std::string name) : width{w}, height{h}, name{name} {
    this->init();
  }

  Window::~Window() {
    this->destroy();
  }

  void Window::init() {
    glfwInit();
    glfwWindowHint(GLFW_CLIENT_API, GLFW_NO_API);
    glfwWindowHint(GLFW_RESIZABLE, GLFW_TRUE);

    this->window = glfwCreateWindow(this->width, this->height, this->name.c_str(), nullptr, nullptr);
    glfwSetWindowUserPointer(this->window, this);
    glfwSetFramebufferSizeCallback(this->window, this->frameBufferResizedCallback);
  }

  void Window::destroy() {
    glfwDestroyWindow(this->window);
    glfwTerminate();
  }

  bool Window::shouldClose() {
    return glfwWindowShouldClose(this->window);
  }

  void Window::pollEvents() {
    glfwPollEvents();
  }

  void Window::createWindowSurface(VkInstance instance, VkSurfaceKHR* surface) {
    if (glfwCreateWindowSurface(instance, this->window, nullptr, surface) != VK_SUCCESS) {
      throw std::runtime_error("failed to create window surface");
    }
  }

  void Window::resetResizedFlag() {
    this->frameBufferResized = false;
  }

  VkExtent2D Window::getExtent() {
    return { static_cast<uint32_t>(this->width), static_cast<uint32_t>(this->height) };
  }

  void Window::frameBufferResizedCallback(GLFWwindow *window, int width, int height) {
    auto currentWindow = reinterpret_cast<Window*>(glfwGetWindowUserPointer(window));
    currentWindow->frameBufferResized = true;
    currentWindow->width = width;
    currentWindow->height = height;
  }
}