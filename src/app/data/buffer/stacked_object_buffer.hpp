#pragma once

#include "../../../vulkan/device/device.hpp"
#include "../../../vulkan/buffer/buffer.hpp"
#include "../../../vulkan/command/command_buffer.hpp"
#include "stacked_array_info.hpp"

#include <vector>
#include <memory>
#include <map>
#include <string>

namespace NugieApp {
    class StackedObjectBuffer {
    public:
        class Builder {
        public:
            Builder(NugieVulkan::Device *device, VkBufferUsageFlags usageFlags, uint32_t bufferCount);

            Builder &addArrayItem(VkDeviceSize instanceSize, uint32_t count);

            Builder &addArrayItem(const std::string &id, VkDeviceSize instanceSize, uint32_t count);

            StackedObjectBuffer *build();

        private:
            NugieVulkan::Device *device = nullptr;
            VkBufferUsageFlags usageFlags;

            std::vector<ArrayItemInfo> arrayItemInfos;
            uint32_t bufferCount;
            bool isAlsoCreateStaging;
        };

        StackedObjectBuffer(NugieVulkan::Device *device, VkBufferUsageFlags usageFlags,
                               const std::vector<ArrayItemInfo> &arrayItemInfos, uint32_t bufferCount);

        ~StackedObjectBuffer();

        NugieVulkan::Buffer *getBuffer(uint32_t bufferIndex) const { return this->buffers[bufferIndex]; }

        std::vector<VkDescriptorBufferInfo> getInfo(uint32_t arrayIndex);

        std::vector<VkDescriptorBufferInfo> getInfo(const std::string &arrayId);

        void writeValue(uint32_t bufferIndex, uint32_t arrayIndex, void* data);

        void writeValue(uint32_t bufferIndex, std::string arrayId, void* data);

        void transitionBuffer(NugieVulkan::CommandBuffer *commandBuffer, uint32_t bufferIndex, uint32_t arrayIndex,
                              VkPipelineStageFlags srcStage, VkPipelineStageFlags dstStage, VkAccessFlags srcAccess,
                              VkAccessFlags dstAccess,
                              uint32_t srcQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED,
                              uint32_t dstQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED);

        void
        transitionBuffer(NugieVulkan::CommandBuffer *commandBuffer, uint32_t bufferIndex, const std::string &arrayId,
                         VkPipelineStageFlags srcStage, VkPipelineStageFlags dstStage, VkAccessFlags srcAccess,
                         VkAccessFlags dstAccess,
                         uint32_t srcQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED,
                         uint32_t dstQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED);

        void initializeValue(NugieVulkan::CommandBuffer *commandBuffer, uint32_t value = 0u);

    private:
        NugieVulkan::Device *device = nullptr;

        std::vector<NugieVulkan::Buffer *> buffers;
        bool isAlsoCreateStaging;

        std::vector<ArrayItemBufferInfo> arrayItemBufferInfos;
        std::map<std::string, int> arrayIdMaps;        

        void
        createBuffers(VkBufferUsageFlags usageFlags, const std::vector<ArrayItemInfo> &arrayItemInfos,
                      uint32_t bufferCount);
    };


} // namespace NugieApp
