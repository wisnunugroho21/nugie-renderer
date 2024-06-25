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
        class Builder {
        public:
            Builder(Device *device, VkSurfaceKHR surface, uint32_t width, uint32_t height);

            Builder &setDefault();

            Builder &setOldSwapChain(SwapChain *oldSwapChain);

            Builder &setMinImageCount(uint32_t minImageCount);

            Builder &setImageFormat(VkFormat imageFormat);

            Builder &setImageColorSpace(VkColorSpaceKHR imageColorSpace);

            Builder &setImageArrayLayers(uint32_t imageArrayLayers);

            Builder &setImageUsage(VkImageUsageFlags imageUsage);

            Builder &setPreTransform(VkSurfaceTransformFlagBitsKHR preTransform);

            Builder &setCompositeAlpha(VkCompositeAlphaFlagBitsKHR compositeAlpha);

            Builder &setPresentMode(VkPresentModeKHR presentMode);

            Builder &setIsClipped(VkBool32 isClipped);

            SwapChain *build();
        
        private:

            Device *device;
            SwapChain *oldSwapChain;

            VkSurfaceKHR surface;
            VkExtent2D extent;
            uint32_t minImageCount;
            VkFormat imageFormat;
            VkColorSpaceKHR imageColorSpace;
            uint32_t imageArrayLayers;
            VkImageUsageFlags imageUsage;
            VkSurfaceTransformFlagBitsKHR preTransform;
            VkCompositeAlphaFlagBitsKHR compositeAlpha;
            VkPresentModeKHR presentMode;
            VkBool32 isClipped;

            static VkExtent2D chooseSwapExtent(const VkSurfaceCapabilitiesKHR &capabilities, VkExtent2D windowExtent);

            static VkSurfaceFormatKHR chooseSwapSurfaceFormat(const std::vector<VkSurfaceFormatKHR> &availableFormats);

            static VkPresentModeKHR chooseSwapPresentMode(const std::vector<VkPresentModeKHR> &availablePresentModes);
        };

        SwapChain(Device *device,
                  SwapChain *oldSwapChain,
                  VkSurfaceKHR surface,
                  VkExtent2D extent,
                  uint32_t minImageCount,
                  VkFormat imageFormat,
                  VkColorSpaceKHR imageColorSpace,
                  uint32_t imageArrayLayers,
                  VkImageUsageFlags imageUsage,
                  VkSurfaceTransformFlagBitsKHR preTransform,
                  VkCompositeAlphaFlagBitsKHR compositeAlpha,
                  VkPresentModeKHR presentMode,
                  VkBool32 isClipped);

        ~SwapChain();

        VkFormat getSwapChainImageFormat() const { return this->swapChainImageFormat; }

        VkExtent2D getSwapChainExtent() const { return this->swapChainExtent; }

        uint32_t getImageCount() const { return static_cast<uint32_t>(this->swapChainImages.size()); }

        uint32_t getWidth() const { return this->swapChainExtent.width; }

        uint32_t getHeight() const { return this->swapChainExtent.height; }

        std::vector<Image *> getswapChainImages() const { return this->swapChainImages; }

        float getAspectRatio() const {
            return static_cast<float>(this->swapChainExtent.width) / static_cast<float>(this->swapChainExtent.height);
        }

        bool compareSwapFormat(const SwapChain *swapChain) {
            return swapChain->swapChainImageFormat == this->swapChainImageFormat;
        }

        VkResult 
        acquireNextImage(uint32_t *imageIndex, VkSemaphore imageAvailableSemaphore);

        VkResult
        presentRenders(VkQueue queue, const uint32_t *imageIndex, const std::vector<VkSemaphore> &waitSemaphores);

    private:
        void createSwapChain(VkSurfaceKHR surface,
                             uint32_t minImageCount,
                             VkFormat imageFormat,
                             VkColorSpaceKHR imageColorSpace,
                             uint32_t imageArrayLayers,
                             VkImageUsageFlags imageUsage,
                             VkSurfaceTransformFlagBitsKHR preTransform,
                             VkCompositeAlphaFlagBitsKHR compositeAlpha,
                             VkPresentModeKHR presentMode,
                             VkBool32 isClipped);

        Device *device = nullptr;
        SwapChain *oldSwapChain = nullptr;

        VkSwapchainKHR swapChain;
        VkFormat swapChainImageFormat;
        VkExtent2D swapChainExtent;

        std::vector<Image *> swapChainImages;
        size_t currentFrame = 0;
    };
}
