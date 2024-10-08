#include "device.hpp"

#define VMA_IMPLEMENTATION

#include "vk_mem_alloc.h"

// std headers
#include <cstring>
#include <iostream>
#include <set>
#include <unordered_set>
#include <map>

namespace NugieVulkan {

    // local callback functions
    static VKAPI_ATTR VkBool32 VKAPI_CALL debugCallback(
            VkDebugUtilsMessageSeverityFlagBitsEXT messageSeverity,
            VkDebugUtilsMessageTypeFlagsEXT messageType,
            const VkDebugUtilsMessengerCallbackDataEXT *pCallbackData,
            void *pUserData) 
    {
        std::cerr << "validation layer: " << pCallbackData->pMessage << std::endl;
        return VK_FALSE;
    }

    VkResult CreateDebugUtilsMessengerEXT(
            VkInstance instance,
            const VkDebugUtilsMessengerCreateInfoEXT *pCreateInfo,
            const VkAllocationCallbacks *pAllocator,
            VkDebugUtilsMessengerEXT *pDebugMessenger) 
    {
        auto func = (PFN_vkCreateDebugUtilsMessengerEXT) vkGetInstanceProcAddr(
                instance,
                "vkCreateDebugUtilsMessengerEXT"
        );

        if (func != nullptr) {
            return func(instance, pCreateInfo, pAllocator, pDebugMessenger);
        } else {
            return VK_ERROR_EXTENSION_NOT_PRESENT;
        }
    }

    void DestroyDebugUtilsMessengerEXT(
            VkInstance instance,
            VkDebugUtilsMessengerEXT debugMessenger,
            const VkAllocationCallbacks *pAllocator) 
    {
        auto func = (PFN_vkDestroyDebugUtilsMessengerEXT) vkGetInstanceProcAddr(
                instance,
                "vkDestroyDebugUtilsMessengerEXT"
        );

        if (func != nullptr) {
            func(instance, debugMessenger, pAllocator);
        }
    }

    // class member functions
    Device::Device(Window *window) : window{window} {
        this->createInstance();
        this->setupDebugMessenger();
        this->createSurface();
        this->pickPhysicalDevice();
        this->msaaSamples = this->getMaxSampleNumber();
        this->createLogicalDevice();
        this->createMemoryAllocator();
    }

    Device::~Device() {
        vmaDestroyAllocator(this->memoryAllocator);
        vkDestroyDevice(this->device, nullptr);

        if (enableValidationLayers) {
            DestroyDebugUtilsMessengerEXT(this->instance, this->debugMessenger, nullptr);
        }

        vkDestroySurfaceKHR(this->instance, this->surface, nullptr);
        vkDestroyInstance(this->instance, nullptr);
    }

    void Device::createInstance() {
        if (enableValidationLayers && !this->checkValidationLayerSupport()) {
            throw std::runtime_error("validation layers requested, but not available!");
        }

        VkApplicationInfo appInfo{};
        appInfo.sType = VK_STRUCTURE_TYPE_APPLICATION_INFO;
        appInfo.pApplicationName = "Nugie App";
        appInfo.applicationVersion = VK_MAKE_VERSION(1, 0, 0);
        appInfo.engineVersion = VK_MAKE_VERSION(1, 0, 0);
        appInfo.apiVersion = VK_API_VERSION_1_3;

        VkInstanceCreateInfo createInfo{};
        createInfo.sType = VK_STRUCTURE_TYPE_INSTANCE_CREATE_INFO;
        createInfo.pApplicationInfo = &appInfo;

#ifdef __APPLE__
        createInfo.flags = VK_INSTANCE_CREATE_ENUMERATE_PORTABILITY_BIT_KHR;
#endif

        auto extensions = this->getRequiredExtensions();
        createInfo.enabledExtensionCount = static_cast<uint32_t>(extensions.size());
        createInfo.ppEnabledExtensionNames = extensions.data();

        if (enableValidationLayers) {
            createInfo.enabledLayerCount = static_cast<uint32_t>(this->validationLayers.size());
            createInfo.ppEnabledLayerNames = this->validationLayers.data();

            VkDebugUtilsMessengerCreateInfoEXT debugCreateInfo{};
            NugieVulkan::Device::populateDebugMessengerCreateInfo(debugCreateInfo);

            createInfo.pNext = (VkDebugUtilsMessengerCreateInfoEXT *) &debugCreateInfo;
        } else {
            createInfo.enabledLayerCount = 0;
            createInfo.pNext = nullptr;
        }

        if (vkCreateInstance(&createInfo, nullptr, &this->instance) != VK_SUCCESS) {
            throw std::runtime_error("failed to create instance!");
        }

        this->hasGflwRequiredInstanceExtensions();
    }

    void Device::pickPhysicalDevice() {
        uint32_t deviceCount = 0;
        vkEnumeratePhysicalDevices(this->instance, &deviceCount, nullptr);

        if (deviceCount == 0) {
            throw std::runtime_error("failed to find GPUs with Vulkan support!");
        }

        std::cout << "Device count: " << deviceCount << std::endl;
        std::vector<VkPhysicalDevice> devices(deviceCount);
        vkEnumeratePhysicalDevices(this->instance, &deviceCount, devices.data());

        std::multimap<uint32_t, VkPhysicalDevice> candidates;
        for (const auto &device: devices) {
            uint32_t score = this->rateDeviceSuitability(device);
            candidates.insert(std::make_pair(score, device));
        }

        if (candidates.rbegin()->first == 0) {
            throw std::runtime_error("failed to find a suitable GPU!");
        }

        physicalDevice = candidates.rbegin()->second;

        vkGetPhysicalDeviceProperties(this->physicalDevice, &this->properties);
        std::cout << "selected physical device: " << this->properties.deviceName << std::endl;
    }

    void Device::createLogicalDevice() {
        VkDeviceCreateInfo createInfo{};
        createInfo.sType = VK_STRUCTURE_TYPE_DEVICE_CREATE_INFO;

        this->familyIndices = this->findQueueFamilies(this->physicalDevice);
        float queuePriority = 1.0f;

        VkDeviceQueueCreateInfo graphicQueueCreateInfo{};
        graphicQueueCreateInfo.sType = VK_STRUCTURE_TYPE_DEVICE_QUEUE_CREATE_INFO;
        graphicQueueCreateInfo.queueFamilyIndex = this->familyIndices.graphicsFamily;
        graphicQueueCreateInfo.queueCount = 1u;
        graphicQueueCreateInfo.pQueuePriorities = &queuePriority;

        std::vector<VkDeviceQueueCreateInfo> queueCreateInfos = {graphicQueueCreateInfo};

        if (this->familyIndices.presentFamily != this->familyIndices.transferFamily
            && this->familyIndices.transferFamily != this->familyIndices.graphicsFamily
            && this->familyIndices.presentFamily != this->familyIndices.graphicsFamily) {
            VkDeviceQueueCreateInfo presentQueueCreateInfo{};
            presentQueueCreateInfo.sType = VK_STRUCTURE_TYPE_DEVICE_QUEUE_CREATE_INFO;
            presentQueueCreateInfo.queueFamilyIndex = this->familyIndices.presentFamily;
            presentQueueCreateInfo.queueCount = 1u;
            presentQueueCreateInfo.pQueuePriorities = &queuePriority;

            queueCreateInfos.emplace_back(presentQueueCreateInfo);

            VkDeviceQueueCreateInfo transferQueueCreateInfo{};
            transferQueueCreateInfo.sType = VK_STRUCTURE_TYPE_DEVICE_QUEUE_CREATE_INFO;
            transferQueueCreateInfo.queueFamilyIndex = this->familyIndices.transferFamily;
            transferQueueCreateInfo.queueCount = 1u;
            transferQueueCreateInfo.pQueuePriorities = &queuePriority;

            queueCreateInfos.emplace_back(transferQueueCreateInfo);
        } else if (this->familyIndices.presentFamily == this->familyIndices.transferFamily
                   && this->familyIndices.presentFamily != this->familyIndices.graphicsFamily) {
            VkDeviceQueueCreateInfo queueCreateInfo{};
            queueCreateInfo.sType = VK_STRUCTURE_TYPE_DEVICE_QUEUE_CREATE_INFO;
            queueCreateInfo.queueFamilyIndex = this->familyIndices.presentFamily;
            queueCreateInfo.queueCount = 1u;
            queueCreateInfo.pQueuePriorities = &queuePriority;

            queueCreateInfos.emplace_back(queueCreateInfo);
        } else if (this->familyIndices.presentFamily != this->familyIndices.transferFamily
                   && this->familyIndices.presentFamily == this->familyIndices.graphicsFamily) {
            VkDeviceQueueCreateInfo queueCreateInfo{};
            queueCreateInfo.sType = VK_STRUCTURE_TYPE_DEVICE_QUEUE_CREATE_INFO;
            queueCreateInfo.queueFamilyIndex = this->familyIndices.transferFamily;
            queueCreateInfo.queueCount = 1u;
            queueCreateInfo.pQueuePriorities = &queuePriority;

            queueCreateInfos.emplace_back(queueCreateInfo);
        } else if (this->familyIndices.presentFamily != this->familyIndices.transferFamily
                   && this->familyIndices.transferFamily == this->familyIndices.graphicsFamily) {
            VkDeviceQueueCreateInfo queueCreateInfo{};
            queueCreateInfo.sType = VK_STRUCTURE_TYPE_DEVICE_QUEUE_CREATE_INFO;
            queueCreateInfo.queueFamilyIndex = this->familyIndices.presentFamily;
            queueCreateInfo.queueCount = 1u;
            queueCreateInfo.pQueuePriorities = &queuePriority;

            queueCreateInfos.emplace_back(queueCreateInfo);
        }

        createInfo.queueCreateInfoCount = static_cast<uint32_t>(queueCreateInfos.size());
        createInfo.pQueueCreateInfos = queueCreateInfos.data();

        VkPhysicalDeviceFeatures deviceFeatures{};
        deviceFeatures.samplerAnisotropy = VK_TRUE;
        deviceFeatures.sampleRateShading = VK_TRUE;
        deviceFeatures.fillModeNonSolid = VK_TRUE;
        deviceFeatures.tessellationShader = VK_TRUE;
        deviceFeatures.multiDrawIndirect = VK_TRUE;

        createInfo.pEnabledFeatures = &deviceFeatures;

#ifdef __APPLE__
        this->deviceExtensions.emplace_back("VK_KHR_portability_subset");
#else
        this->deviceExtensions.emplace_back(VK_EXT_MESH_SHADER_EXTENSION_NAME);

        VkPhysicalDeviceMeshShaderFeaturesEXT meshShaderFeatures{};
        meshShaderFeatures.sType = VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_MESH_SHADER_FEATURES_EXT;
        meshShaderFeatures.meshShader = true;
        meshShaderFeatures.taskShader = true;

        createInfo.pNext = &meshShaderFeatures;
#endif

        createInfo.enabledExtensionCount = static_cast<uint32_t>(deviceExtensions.size());
        createInfo.ppEnabledExtensionNames = deviceExtensions.data();

        // might not really be necessary anymore because device specific validation layers
        // have been deprecated
        if (enableValidationLayers) {
            createInfo.enabledLayerCount = static_cast<uint32_t>(this->validationLayers.size());
            createInfo.ppEnabledLayerNames = this->validationLayers.data();
        } else {
            createInfo.enabledLayerCount = 0;
        }

        if (vkCreateDevice(this->physicalDevice, &createInfo, nullptr, &this->device) != VK_SUCCESS) {
            throw std::runtime_error("failed to create logical device!");
        }

        vkGetDeviceQueue(this->device, this->familyIndices.graphicsFamily, 0, &this->graphicsQueue);
        vkGetDeviceQueue(this->device, this->familyIndices.presentFamily, 0, &this->presentQueue);
        vkGetDeviceQueue(this->device, this->familyIndices.transferFamily, 0, &this->transferQueue);
    }

    void Device::createSurface() {
        this->window->createWindowSurface(this->instance, &this->surface);
    }

    void Device::createMemoryAllocator() {
        VmaAllocatorCreateInfo allocatorCreateInfo = {};
        allocatorCreateInfo.vulkanApiVersion = VK_API_VERSION_1_2;
        allocatorCreateInfo.physicalDevice = this->physicalDevice;
        allocatorCreateInfo.device = this->device;
        allocatorCreateInfo.instance = this->instance;

        vmaCreateAllocator(&allocatorCreateInfo, &this->memoryAllocator);
    }

    uint32_t Device::rateDeviceSuitability(VkPhysicalDevice device) {
        uint32_t score = 0u;

        bool extensionsSupported = this->checkDeviceExtensionSupport(device);
        if (!extensionsSupported) {
            return score;
        }

        QueueFamilyIndices indices = this->findQueueFamilies(device);
        if (!indices.isComplete()) {
            return score;
        }

        SwapChainSupportDetails swapChainSupport = this->querySwapChainSupport(device);
        if (swapChainSupport.formats.empty() || swapChainSupport.presentModes.empty()) {
            return score;
        }

        VkPhysicalDeviceFeatures supportedFeatures;
        vkGetPhysicalDeviceFeatures(device, &supportedFeatures);

        if (!supportedFeatures.samplerAnisotropy || !supportedFeatures.sampleRateShading) {
            return score;
        }

        VkPhysicalDeviceProperties deviceProperties;
        vkGetPhysicalDeviceProperties(device, &deviceProperties);

        score += deviceProperties.deviceType == VK_PHYSICAL_DEVICE_TYPE_DISCRETE_GPU ? 1000u : 0u;
        score += deviceProperties.limits.maxImageDimension2D;

        return score;
    }

    void Device::populateDebugMessengerCreateInfo(VkDebugUtilsMessengerCreateInfoEXT &createInfo) {
        createInfo.sType = VK_STRUCTURE_TYPE_DEBUG_UTILS_MESSENGER_CREATE_INFO_EXT;
        createInfo.messageSeverity = VK_DEBUG_UTILS_MESSAGE_SEVERITY_WARNING_BIT_EXT
                                     | VK_DEBUG_UTILS_MESSAGE_SEVERITY_ERROR_BIT_EXT;
        createInfo.messageType = VK_DEBUG_UTILS_MESSAGE_TYPE_GENERAL_BIT_EXT
                                 | VK_DEBUG_UTILS_MESSAGE_TYPE_VALIDATION_BIT_EXT
                                 | VK_DEBUG_UTILS_MESSAGE_TYPE_PERFORMANCE_BIT_EXT;

        createInfo.pfnUserCallback = debugCallback;
        createInfo.pUserData = nullptr;  // Optional
    }

    void Device::setupDebugMessenger() {
        if (!this->enableValidationLayers) return;

        VkDebugUtilsMessengerCreateInfoEXT createInfo{};
        this->populateDebugMessengerCreateInfo(createInfo);

        if (CreateDebugUtilsMessengerEXT(this->instance, &createInfo, nullptr, &this->debugMessenger) != VK_SUCCESS) {
            throw std::runtime_error("failed to set up debug messenger!");
        }
    }

    bool Device::checkValidationLayerSupport() {
        uint32_t layerCount;
        vkEnumerateInstanceLayerProperties(&layerCount, nullptr);

        std::vector<VkLayerProperties> availableLayers(layerCount);
        vkEnumerateInstanceLayerProperties(&layerCount, availableLayers.data());

        for (const char *layerName: this->validationLayers) {
            bool layerFound = false;

            for (const auto &layerProperties: availableLayers) {
                if (strcmp(layerName, layerProperties.layerName) == 0) {
                    layerFound = true;
                    break;
                }
            }

            if (!layerFound) {
                return false;
            }
        }

        return true;
    }

    std::vector<const char *> Device::getRequiredExtensions() {
        uint32_t glfwExtensionCount = 0;
        const char **glfwExtensions;
        glfwExtensions = glfwGetRequiredInstanceExtensions(&glfwExtensionCount);

        std::vector<const char *> extensions(glfwExtensions, glfwExtensions + glfwExtensionCount);

        if (this->enableValidationLayers) {
            extensions.push_back(VK_EXT_DEBUG_UTILS_EXTENSION_NAME);
        }

#ifdef __APPLE__
        extensions.push_back(VK_KHR_PORTABILITY_ENUMERATION_EXTENSION_NAME);
#endif

        return extensions;
    }

    void Device::hasGflwRequiredInstanceExtensions() {
        uint32_t extensionCount = 0;
        vkEnumerateInstanceExtensionProperties(nullptr, &extensionCount, nullptr);
        std::vector<VkExtensionProperties> extensions(extensionCount);
        vkEnumerateInstanceExtensionProperties(nullptr, &extensionCount, extensions.data());

        std::cout << "available extensions:" << std::endl;
        std::unordered_set<std::string> available;
        for (const auto &extension: extensions) {
            std::cout << "\t" << extension.extensionName << std::endl;
            available.insert(extension.extensionName);
        }

        std::cout << "required extensions:" << std::endl;
        auto requiredExtensions = this->getRequiredExtensions();
        for (const auto &required: requiredExtensions) {
            std::cout << "\t" << required << std::endl;

            if (available.find(required) == available.end()) {
                throw std::runtime_error("Missing required glfw extension");
            }
        }
    }

    bool Device::checkDeviceExtensionSupport(VkPhysicalDevice device) {
        uint32_t extensionCount;
        vkEnumerateDeviceExtensionProperties(device, nullptr, &extensionCount, nullptr);

        std::vector<VkExtensionProperties> availableExtensions(extensionCount);
        vkEnumerateDeviceExtensionProperties(
                device,
                nullptr,
                &extensionCount,
                availableExtensions.data()
        );

        std::set<std::string> requiredExtensions(deviceExtensions.begin(), deviceExtensions.end());

        for (const auto &extension: availableExtensions) {
            requiredExtensions.erase(extension.extensionName);
        }

        return requiredExtensions.empty();
    }

    QueueFamilyIndices Device::findQueueFamilies(VkPhysicalDevice device) {
        QueueFamilyIndices indices;

        uint32_t queueFamilyCount = 0;
        vkGetPhysicalDeviceQueueFamilyProperties(device, &queueFamilyCount, nullptr);

        std::vector<VkQueueFamilyProperties> queueFamilies(queueFamilyCount);
        vkGetPhysicalDeviceQueueFamilyProperties(device, &queueFamilyCount, queueFamilies.data());

        for (uint32_t i = 0; i < queueFamilyCount; i++) {
            if (queueFamilies[i].queueCount > 0 && queueFamilies[i].queueFlags & VK_QUEUE_GRAPHICS_BIT) {
                indices.graphicsFamily = i;
                indices.graphicsCount = queueFamilies[i].queueCount;
                indices.graphicsFamilyHasValue = true;
            }

            if (indices.graphicsFamilyHasValue) {
                break;
            }
        }

        for (uint32_t i = 0; i < queueFamilyCount; i++) {
            if (indices.graphicsFamily == i) {
                continue;
            }

            VkBool32 presentSupport = false;
            vkGetPhysicalDeviceSurfaceSupportKHR(device, i, this->surface, &presentSupport);
            if (queueFamilies[i].queueCount > 0 && presentSupport) {
                indices.presentFamily = i;
                indices.presentCount = queueFamilies[i].queueCount;
                indices.presentFamilyHasValue = true;
            }

            if (queueFamilies[i].queueCount > 0 && queueFamilies[i].queueFlags & VK_QUEUE_TRANSFER_BIT) {
                indices.transferFamily = i;
                indices.transferCount = queueFamilies[i].queueCount;
                indices.transferFamilyHasValue = true;
            }

            if (indices.transferFamilyHasValue && indices.presentFamilyHasValue) {
                break;
            }
        }

        if (!indices.transferFamilyHasValue) {
            if (queueFamilies[indices.graphicsFamily].queueFlags & VK_QUEUE_TRANSFER_BIT) {
                indices.transferFamily = indices.graphicsFamily;
                indices.transferCount = indices.graphicsCount;
                indices.transferFamilyHasValue = true;
            }
        }

        if (!indices.presentFamilyHasValue) {
            VkBool32 presentSupport = false;
            vkGetPhysicalDeviceSurfaceSupportKHR(device, indices.graphicsFamily, this->surface, &presentSupport);

            if (queueFamilies[indices.graphicsFamily].queueFlags & presentSupport) {
                indices.presentFamily = indices.graphicsFamily;
                indices.presentCount = indices.graphicsCount;
                indices.presentFamilyHasValue = true;
            }
        }

        return indices;
    }

    SwapChainSupportDetails Device::querySwapChainSupport(VkPhysicalDevice device) {
        SwapChainSupportDetails details;
        vkGetPhysicalDeviceSurfaceCapabilitiesKHR(device, this->surface, &details.capabilities);

        uint32_t formatCount;
        vkGetPhysicalDeviceSurfaceFormatsKHR(device, this->surface, &formatCount, nullptr);

        if (formatCount != 0) {
            details.formats.resize(formatCount);
            vkGetPhysicalDeviceSurfaceFormatsKHR(device, this->surface, &formatCount, details.formats.data());
        }

        uint32_t presentModeCount;
        vkGetPhysicalDeviceSurfacePresentModesKHR(device, this->surface, &presentModeCount, nullptr);

        if (presentModeCount != 0) {
            details.presentModes.resize(presentModeCount);
            vkGetPhysicalDeviceSurfacePresentModesKHR(
                    device,
                    this->surface,
                    &presentModeCount,
                    details.presentModes.data()
            );
        }

        return details;
    }

    VkFormat Device::findSupportedFormat(const std::vector<VkFormat> &candidates,
                                         VkImageTiling tiling, VkFormatFeatureFlags features) 
    {
        for (VkFormat format: candidates) {
            VkFormatProperties props;
            vkGetPhysicalDeviceFormatProperties(this->physicalDevice, format, &props);

            if (tiling == VK_IMAGE_TILING_LINEAR && (props.linearTilingFeatures & features) == features) {
                return format;
            } else if (tiling == VK_IMAGE_TILING_OPTIMAL && (props.optimalTilingFeatures & features) == features) {
                return format;
            }
        }

        throw std::runtime_error("failed to find supported format!");
    }

    uint32_t Device::findMemoryType(uint32_t typeFilter, VkMemoryPropertyFlags property) {
        VkPhysicalDeviceMemoryProperties memProperties;
        vkGetPhysicalDeviceMemoryProperties(this->physicalDevice, &memProperties);

        for (uint32_t i = 0; i < memProperties.memoryTypeCount; i++) {
            if ((typeFilter & (1 << i)) &&
                (memProperties.memoryTypes[i].propertyFlags & property) == property) {
                return i;
            }
        }

        throw std::runtime_error("failed to find suitable memory type!");
    }

    uint32_t Device::findMemoryType(uint32_t typeFilter, const std::vector<VkMemoryPropertyFlags> &properties,
                                    VkMemoryPropertyFlags *selectedProperty) 
    {
        VkPhysicalDeviceMemoryProperties memProperties;
        vkGetPhysicalDeviceMemoryProperties(this->physicalDevice, &memProperties);

        for (auto &&property: properties) {
            for (uint32_t i = 0; i < memProperties.memoryTypeCount; i++) {
                if ((typeFilter & (1 << i)) && (memProperties.memoryTypes[i].propertyFlags & property) == property) {
                    if (selectedProperty != nullptr) {
                        *selectedProperty = property;
                    }

                    return i;
                }
            }
        }

        throw std::runtime_error("failed to find suitable memory type!");
    }

    VkSampleCountFlagBits Device::getMaxSampleNumber() const {
        VkSampleCountFlags counts = this->properties.limits.framebufferColorSampleCounts &
                                    this->properties.limits.framebufferDepthSampleCounts;

        // if (counts & VK_SAMPLE_COUNT_64_BIT) return VK_SAMPLE_COUNT_64_BIT;
        // if (counts & VK_SAMPLE_COUNT_32_BIT) return VK_SAMPLE_COUNT_32_BIT;
        // if (counts & VK_SAMPLE_COUNT_16_BIT) return VK_SAMPLE_COUNT_16_BIT;
        // if (counts & VK_SAMPLE_COUNT_8_BIT) return VK_SAMPLE_COUNT_8_BIT;
        // if (counts & VK_SAMPLE_COUNT_4_BIT) return VK_SAMPLE_COUNT_4_BIT;
        // if (counts & VK_SAMPLE_COUNT_2_BIT) return VK_SAMPLE_COUNT_2_BIT;

        return VK_SAMPLE_COUNT_1_BIT;
    }
}  // namespace lve