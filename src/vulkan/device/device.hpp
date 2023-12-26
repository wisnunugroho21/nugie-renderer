#pragma once

#include "../window/window.hpp"

// std lib headers
#include <string>
#include <vector>


namespace NugieVulkan {
  struct SwapChainSupportDetails {
    VkSurfaceCapabilitiesKHR capabilities;
    std::vector<VkSurfaceFormatKHR> formats;
    std::vector<VkPresentModeKHR> presentModes;
  };

  struct QueueFamilyIndices {
    uint32_t graphicsFamily;
    uint32_t presentFamily;
    uint32_t transferFamily;

    uint32_t graphicsCount;
    uint32_t presentCount;
    uint32_t transferCount;

    bool graphicsFamilyHasValue = false;
    bool presentFamilyHasValue = false;
    bool transferFamilyHasValue = false;

    bool isComplete() { return graphicsFamilyHasValue && presentFamilyHasValue && transferFamilyHasValue; }
  };

  class Device {
    public:
    #ifdef NDEBUG
      const bool enableValidationLayers = false;
    #else
      const bool enableValidationLayers = true;
    #endif

      Device(Window* window);
      ~Device();
      
      VkDevice getLogicalDevice() const { return this->device; }
      VkPhysicalDevice getPhysicalDevice() const { return this->physicalDevice; }
      VkSurfaceKHR getSurface() const { return this->surface; }
      VkInstance getInstance() const { return this->instance; }

      VkQueue getGraphicsQueue() const { return this->graphicsQueue; }
      VkQueue getPresentQueue() const { return this->presentQueue; }
      VkQueue getTransferQueue() const { return this->transferQueue; }

      QueueFamilyIndices getFamilyIndices() const { return this->familyIndices; }
      
      VkPhysicalDeviceProperties getProperties() const { return this->properties; }
      VkSampleCountFlagBits getMSAASamples() const { return this->msaaSamples; }

      SwapChainSupportDetails getSwapChainSupport() { return this->querySwapChainSupport(this->physicalDevice); }
      QueueFamilyIndices getPhysicalQueueFamilies() { return this->findQueueFamilies(this->physicalDevice); }

      uint32_t findMemoryType(uint32_t typeFilter, VkMemoryPropertyFlags property);
      uint32_t findMemoryType(uint32_t typeFilter, const std::vector<VkMemoryPropertyFlags> &properties, VkMemoryPropertyFlags *selectedProperty);

      VkFormat findSupportedFormat(const std::vector<VkFormat> &candidates, VkImageTiling tiling, VkFormatFeatureFlags features);

    private:
      // creation function
      void createInstance();
      void setupDebugMessenger();
      void createSurface();
      void pickPhysicalDevice();
      void createLogicalDevice();

      // helper creation functions
      bool checkDeviceExtensionSupport(VkPhysicalDevice device);
      bool checkValidationLayerSupport();
      void populateDebugMessengerCreateInfo(VkDebugUtilsMessengerCreateInfoEXT &createInfo);
      void hasGflwRequiredInstanceExtensions();
      uint32_t rateDeviceSuitability(VkPhysicalDevice device);
      std::vector<const char *> getRequiredExtensions();
      QueueFamilyIndices findQueueFamilies(VkPhysicalDevice device);
      SwapChainSupportDetails querySwapChainSupport(VkPhysicalDevice device);
      VkSampleCountFlagBits getMaxSampleNumber();

      // instance
      VkInstance instance;
      VkDebugUtilsMessengerEXT debugMessenger;

      // device & its property
      VkDevice device;
      VkPhysicalDevice physicalDevice = VK_NULL_HANDLE;
      VkPhysicalDeviceProperties properties;

      // window system
      Window* window;
      VkSurfaceKHR surface;

      // queue
      VkQueue graphicsQueue;
      VkQueue presentQueue;
      VkQueue transferQueue;

      // Queue Family Index
      QueueFamilyIndices familyIndices;

      // Anti-aliasing
      VkSampleCountFlagBits msaaSamples = VK_SAMPLE_COUNT_1_BIT;

      std::vector<const char *> validationLayers = {"VK_LAYER_KHRONOS_validation"};
      std::vector<const char *> deviceExtensions = {VK_KHR_SWAPCHAIN_EXTENSION_NAME};
  };

}  // namespace lve