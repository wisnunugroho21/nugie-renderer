#include "swap_chain.hpp"
#include "../command/command_buffer.hpp"

// std
#include <array>
#include <cstdlib>
#include <cstring>
#include <iostream>
#include <limits>
#include <set>
#include <stdexcept>

namespace NugieVulkan {
    SwapChain::Builder::Builder(Device *device, VkSurfaceKHR surface, uint32_t width, uint32_t height) 
                               : device{device}, surface{surface}, extent{width, height}
    {

    }

    SwapChain::Builder &
    SwapChain::Builder::setDefault() {
        SwapChainSupportDetails swapChainSupport = this->device->getSwapChainSupport();

        VkSurfaceFormatKHR surfaceFormat = SwapChain::Builder::chooseSwapSurfaceFormat(swapChainSupport.formats);
        VkPresentModeKHR presentMode = SwapChain::Builder::chooseSwapPresentMode(swapChainSupport.presentModes);
        VkExtent2D extent = SwapChain::Builder::chooseSwapExtent(swapChainSupport.capabilities, this->extent);

        uint32_t imageCount = swapChainSupport.capabilities.minImageCount + 1;
        if (swapChainSupport.capabilities.maxImageCount > 0 &&
            imageCount > swapChainSupport.capabilities.maxImageCount) 
        {
            imageCount = swapChainSupport.capabilities.maxImageCount;
        }
        
        this->extent = extent;
        this->surface = this->device->getSurface();
        this->minImageCount = imageCount;
        this->imageFormat = surfaceFormat.format;
        this->imageColorSpace = surfaceFormat.colorSpace;
        this->imageArrayLayers = 1u;
        this->imageUsage = VK_IMAGE_USAGE_COLOR_ATTACHMENT_BIT | VK_IMAGE_USAGE_TRANSFER_DST_BIT;
        this->preTransform = swapChainSupport.capabilities.currentTransform;
        this->compositeAlpha = VK_COMPOSITE_ALPHA_OPAQUE_BIT_KHR;
        this->presentMode = presentMode;
        this->isClipped = VK_TRUE;
        this->oldSwapChain = nullptr;

        return *this;
    }

    SwapChain::Builder &
    SwapChain::Builder::setOldSwapChain(SwapChain *oldSwapChain) {
        this->oldSwapChain = oldSwapChain;
        return *this;
    }

    SwapChain::Builder &
    SwapChain::Builder::setMinImageCount(uint32_t minImageCount) {
        this->minImageCount = minImageCount;
        return *this;
    }

    SwapChain::Builder &SwapChain::Builder::setImageFormat(VkFormat imageFormat) {
        this->imageFormat = imageFormat;
        return *this;
    }

    SwapChain::Builder &SwapChain::Builder::setImageColorSpace(VkColorSpaceKHR imageColorSpace) {
        this->imageColorSpace = imageColorSpace;
        return *this;
    }

    SwapChain::Builder &SwapChain::Builder::setImageArrayLayers(uint32_t imageArrayLayers) {
        this->imageArrayLayers = imageArrayLayers;
        return *this;
    }

    SwapChain::Builder &SwapChain::Builder::setImageUsage(VkImageUsageFlags imageUsage) {
        this->imageUsage = imageUsage;
        return *this;
    }

    SwapChain::Builder &SwapChain::Builder::setPreTransform(VkSurfaceTransformFlagBitsKHR preTransform) {
        this->preTransform = preTransform;
        return *this;
    }

    SwapChain::Builder &SwapChain::Builder::setCompositeAlpha(VkCompositeAlphaFlagBitsKHR compositeAlpha) {
        this->compositeAlpha = compositeAlpha;
        return *this;
    }

    SwapChain::Builder &SwapChain::Builder::setPresentMode(VkPresentModeKHR presentMode) {
        this->presentMode = presentMode;
        return *this;
    }

    SwapChain::Builder &SwapChain::Builder::setIsClipped(VkBool32 isClipped) {
        this->isClipped = isClipped;
        return *this;
    }

    SwapChain *SwapChain::Builder::build() {
        return new SwapChain(this->device, this->oldSwapChain, this->surface, this->extent, 
                             this->minImageCount, this->imageFormat, this->imageColorSpace, 
                             this->imageArrayLayers, this->imageUsage, this->preTransform, 
                             this->compositeAlpha, this->presentMode, this->isClipped);
    }

    VkExtent2D SwapChain::Builder::chooseSwapExtent(const VkSurfaceCapabilitiesKHR &capabilities, VkExtent2D windowExtent) {
        if (capabilities.currentExtent.width != std::numeric_limits<uint32_t>::max()) {
            return capabilities.currentExtent;
        } else {
            VkExtent2D actualExtent = windowExtent;

            actualExtent.width = std::max(
                    capabilities.minImageExtent.width,
                    std::min(capabilities.maxImageExtent.width, actualExtent.width)
            );

            actualExtent.height = std::max(
                    capabilities.minImageExtent.height,
                    std::min(capabilities.maxImageExtent.height, actualExtent.height)
            );

            return actualExtent;
        }
    }

     VkSurfaceFormatKHR SwapChain::Builder::chooseSwapSurfaceFormat(const std::vector<VkSurfaceFormatKHR> &availableFormats) {
        for (const auto &availableFormat: availableFormats) {
            if (availableFormat.format == VK_FORMAT_R8G8B8A8_SRGB &&
                availableFormat.colorSpace == VK_COLOR_SPACE_SRGB_NONLINEAR_KHR) 
            {
                return availableFormat;
            }
        }

        return availableFormats[0];
    }

    VkPresentModeKHR SwapChain::Builder::chooseSwapPresentMode(const std::vector<VkPresentModeKHR> &availablePresentModes) {
        for (const auto &availablePresentMode: availablePresentModes) {
            if (availablePresentMode == VK_PRESENT_MODE_MAILBOX_KHR) {
                std::cout << "Present mode: Mailbox" << std::endl;
                return availablePresentMode;
            }
        }

        for (const auto &availablePresentMode: availablePresentModes) {
            if (availablePresentMode == VK_PRESENT_MODE_IMMEDIATE_KHR) {
                std::cout << "Present mode: Immediate" << std::endl;
                return availablePresentMode;
            }
        }

        std::cout << "Present mode: V-Sync" << std::endl;
        return VK_PRESENT_MODE_FIFO_KHR;
    }

    SwapChain::SwapChain(Device *device,
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
                         VkBool32 isClipped)
                         : device{device}, swapChainExtent{extent},
                           swapChainImageFormat{imageFormat}
    {
        if (oldSwapChain != nullptr) {
            delete this->oldSwapChain;
            this->oldSwapChain = oldSwapChain;
        }

        this->createSwapChain(surface, minImageCount, imageFormat, 
                              imageColorSpace, imageArrayLayers, 
                              imageUsage, preTransform, compositeAlpha,
                              presentMode, isClipped);
    }

    SwapChain::~SwapChain() {
        delete this->oldSwapChain;

        for (auto &&swapChainImage: this->swapChainImages) {
            delete swapChainImage;
        }

        vkDestroySwapchainKHR(this->device->getLogicalDevice(), this->swapChain, nullptr);
    }

    VkResult SwapChain::acquireNextImage(uint32_t *imageIndex, VkSemaphore imageAvailableSemaphore) {
        VkResult result = vkAcquireNextImageKHR(
                this->device->getLogicalDevice(),
                this->swapChain,
                std::numeric_limits<uint64_t>::max(),
                imageAvailableSemaphore,  // must be a not signaled semaphore
                VK_NULL_HANDLE,
                imageIndex
        );

        return result;
    }

    VkResult
    SwapChain::presentRenders(VkQueue queue, const uint32_t *imageIndex,
                              const std::vector<VkSemaphore> &waitSemaphores) 
    {
        VkPresentInfoKHR presentInfo = {};
        presentInfo.sType = VK_STRUCTURE_TYPE_PRESENT_INFO_KHR;

        presentInfo.waitSemaphoreCount = static_cast<uint32_t>(waitSemaphores.size());
        presentInfo.pWaitSemaphores = waitSemaphores.data();

        presentInfo.swapchainCount = 1u;
        presentInfo.pSwapchains = &this->swapChain;

        presentInfo.pImageIndices = imageIndex;

        auto result = vkQueuePresentKHR(queue, &presentInfo);
        return result;
    }

    void SwapChain::createSwapChain(VkSurfaceKHR surface,
                                    uint32_t minImageCount,
                                    VkFormat imageFormat,
                                    VkColorSpaceKHR imageColorSpace,
                                    uint32_t imageArrayLayers,
                                    VkImageUsageFlags imageUsage,
                                    VkSurfaceTransformFlagBitsKHR preTransform,
                                    VkCompositeAlphaFlagBitsKHR compositeAlpha,
                                    VkPresentModeKHR presentMode,
                                    VkBool32 isClipped) 
    {
        VkSwapchainCreateInfoKHR createInfo = {};
        createInfo.sType = VK_STRUCTURE_TYPE_SWAPCHAIN_CREATE_INFO_KHR;
        createInfo.surface = surface;
        createInfo.minImageCount = minImageCount;
        createInfo.imageFormat = imageFormat;
        createInfo.imageColorSpace = imageColorSpace;
        createInfo.imageExtent = this->swapChainExtent;
        createInfo.imageArrayLayers = imageArrayLayers;
        createInfo.imageUsage = imageUsage;
        createInfo.preTransform = preTransform;
        createInfo.compositeAlpha = compositeAlpha;
        createInfo.presentMode = presentMode;
        createInfo.clipped = isClipped;
        createInfo.oldSwapchain = this->oldSwapChain == nullptr ? VK_NULL_HANDLE : this->oldSwapChain->swapChain;

        QueueFamilyIndices indices = this->device->getPhysicalQueueFamilies();
        uint32_t queueFamilyIndices[] = {indices.graphicsFamily, indices.presentFamily};

        if (indices.graphicsFamily != indices.presentFamily) {
            createInfo.imageSharingMode = VK_SHARING_MODE_CONCURRENT;
            createInfo.queueFamilyIndexCount = 2;
            createInfo.pQueueFamilyIndices = queueFamilyIndices;
        } else {
            createInfo.imageSharingMode = VK_SHARING_MODE_EXCLUSIVE;
            createInfo.queueFamilyIndexCount = 0;      // Optional
            createInfo.pQueueFamilyIndices = nullptr;  // Optional
        }

        if (vkCreateSwapchainKHR(device->getLogicalDevice(), &createInfo, nullptr, &this->swapChain) != VK_SUCCESS) {
            throw std::runtime_error("failed to create swap chain!");
        }

        std::vector<VkImage> tempSwapChainImages;
        uint32_t imageCount = minImageCount;

        vkGetSwapchainImagesKHR(this->device->getLogicalDevice(), swapChain, &imageCount, nullptr);
        tempSwapChainImages.resize(imageCount);
        vkGetSwapchainImagesKHR(this->device->getLogicalDevice(), swapChain, &imageCount, tempSwapChainImages.data());

        this->swapChainImages.clear();
        for (uint32_t i = 0; i < imageCount; i++) {
            auto swapChainImage = new Image(this->device, this->swapChainExtent.width, this->swapChainExtent.height, 
                                            tempSwapChainImages[i], 1, this->swapChainImageFormat, VK_IMAGE_ASPECT_COLOR_BIT);
            this->swapChainImages.push_back(swapChainImage);
        }
    }
}