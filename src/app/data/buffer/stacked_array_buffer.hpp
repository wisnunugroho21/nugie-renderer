#pragma once

#include "../../../vulkan/device/device.hpp"
#include "../../../vulkan/buffer/buffer.hpp"
#include "../../../vulkan/command/command_buffer.hpp"
#include "stacked_array_info.hpp"

#include <vector>
#include <memory>
#include <map>

namespace NugieApp {
    class StackedArrayBuffer {
    public:
        class Builder {
        public:
            Builder(NugieVulkan::Device *device, VkBufferUsageFlags usageFlags, bool isAlsoCreateStaging = true);

            Builder &addArrayItem(VkDeviceSize instanceSize, uint32_t count);

            Builder &addArrayItem(const std::string &arrayId, VkDeviceSize instanceSize, uint32_t count);

            StackedArrayBuffer *build();

        private:
            NugieVulkan::Device *device = nullptr;
            VkBufferUsageFlags usageFlags;

            std::vector<ArrayItemInfo> arrayItemInfos;
            uint32_t bufferCount;
            bool isAlsoCreateStaging;
        };

        StackedArrayBuffer(NugieVulkan::Device *device, VkBufferUsageFlags usageFlags,
                           const std::vector<ArrayItemInfo> &arrayItemInfos,
                           bool isAlsoCreateStaging);

        ~StackedArrayBuffer();

        NugieVulkan::Buffer *getBuffer() const { return this->buffer; }

        VkDescriptorBufferInfo getInfo(uint32_t arrayIndex);

        VkDescriptorBufferInfo getInfo(std::string arrayId);

        void writeValue(NugieVulkan::CommandBuffer *commandBuffer, uint32_t arrayIndex, void* data);

        void writeValue(NugieVulkan::CommandBuffer *commandBuffer, std::string arrayId, void* data);

        void transitionBuffer(NugieVulkan::CommandBuffer *commandBuffer, uint32_t arrayIndex,
                              VkPipelineStageFlags srcStage, VkPipelineStageFlags dstStage, VkAccessFlags srcAccess,
                              VkAccessFlags dstAccess,
                              uint32_t srcQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED,
                              uint32_t dstQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED);

        void transitionBuffer(NugieVulkan::CommandBuffer *commandBuffer, std::string arrayId,
                              VkPipelineStageFlags srcStage, VkPipelineStageFlags dstStage, VkAccessFlags srcAccess,
                              VkAccessFlags dstAccess,
                              uint32_t srcQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED,
                              uint32_t dstQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED);

        void initializeValue(NugieVulkan::CommandBuffer *commandBuffer, uint32_t value = 0u);

    private:
        NugieVulkan::Device *device = nullptr;

        NugieVulkan::Buffer *buffer;
        NugieVulkan::Buffer *stagingBuffer = nullptr;

        std::vector<ArrayItemBufferInfo> arrayItemBufferInfos;
        std::map<std::string, int> arrayIdMaps;

        bool isAlsoCreateStaging = false;

        void createBuffers(VkBufferUsageFlags usageFlags, std::vector<ArrayItemInfo> arrayItemInfos);
    };


} // namespace NugieApp
