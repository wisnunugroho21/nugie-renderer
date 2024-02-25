#pragma once

#include "../device/device.hpp"
#include "../image/image.hpp"
#include "../renderpass/renderpass.hpp"

// vulkan headers
#include <vulkan/vulkan.h>

// std lib headers
#include <string>
#include <vector>
#include <memory>

namespace NugieVulkan {
  class SwapChain {
    public:
      SwapChain(Device* device, VkExtent2D windowExtent);
      SwapChain(Device* device, VkExtent2D windowExtent, SwapChain* previous);

      ~SwapChain();
      
      VkFormat getSwapChainImageFormat() const { return this->swapChainImageFormat; }
      VkExtent2D getSwapChainExtent() const { return this->swapChainExtent; }
      uint32_t getImageCount() const { return static_cast<uint32_t>(this->swapChainImages.size()); }
      uint32_t getWidth() const { return this->swapChainExtent.width; }
      uint32_t getHeight() const { return this->swapChainExtent.height; }
      std::vector<Image*> getswapChainImages() const { return this->swapChainImages; }
      float getAspectRatio() const { return static_cast<float>(this->swapChainExtent.width) / static_cast<float>(this->swapChainExtent.height); }

      bool compareSwapFormat(const SwapChain* swapChain) {
        return swapChain->swapChainImageFormat == this->swapChainImageFormat;
      }

      VkResult acquireNextImage(uint32_t* imageIndex, const std::vector<VkFence> &inFlightFences, VkSemaphore imageAvailableSemaphore);
      VkResult presentRenders(VkQueue queue, uint32_t* imageIndex, const std::vector<VkSemaphore> &waitSemaphores);

    private:
      void init();
      void createSwapChain();

      // Helper functions
      VkSurfaceFormatKHR chooseSwapSurfaceFormat(const std::vector<VkSurfaceFormatKHR> &availableFormats);
      VkPresentModeKHR chooseSwapPresentMode(const std::vector<VkPresentModeKHR> &availablePresentModes);
      VkExtent2D chooseSwapExtent(const VkSurfaceCapabilitiesKHR &capabilities);

      Device* device = nullptr;
      SwapChain* oldSwapChain = nullptr;

      VkSwapchainKHR swapChain;
      VkFormat swapChainImageFormat;
      VkExtent2D swapChainExtent;

      std::vector<Image*> swapChainImages;
      VkExtent2D windowExtent;
      size_t currentFrame = 0;
  };
}
