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

			bool shouldClose();
			void pollEvents();

			void createWindowSurface(VkInstance instance, VkSurfaceKHR* surface);
			VkExtent2D getExtent();
			void resetResizedFlag();
			bool wasResized() { return this->frameBufferResized; }
			GLFWwindow* getWindow() const { return this->window; } 

		private:
			uint32_t width, height;
			bool frameBufferResized = false;

			std::string name;
			GLFWwindow *window;

			void init();
			void destroy();
			static void frameBufferResizedCallback(GLFWwindow *window, int width, int height);
	};
}
