#include "stacked_object_buffer.hpp"

#include <cassert>

namespace NugieApp {
    StackedObjectBuffer::Builder::Builder(NugieVulkan::Device *device, VkBufferUsageFlags usageFlags,
                                             uint32_t bufferCount) 
                                    : device{device}, usageFlags{usageFlags}, bufferCount{bufferCount}
    {
        this->arrayItemInfos.clear();
    }

    StackedObjectBuffer::Builder &
    StackedObjectBuffer::Builder::addArrayItem(VkDeviceSize instanceSize, uint32_t count) {
        this->arrayItemInfos.emplace_back(ArrayItemInfo{
                "",
                instanceSize,
                count
        });

        return *this;
    }

    StackedObjectBuffer::Builder &
    StackedObjectBuffer::Builder::addArrayItem(const std::string &id, VkDeviceSize instanceSize, uint32_t count) {
        this->arrayItemInfos.emplace_back(ArrayItemInfo{
                id,
                instanceSize,
                count
        });

        return *this;
    }

    StackedObjectBuffer *StackedObjectBuffer::Builder::build() {
        return new StackedObjectBuffer(this->device, this->usageFlags, this->arrayItemInfos, this->bufferCount);
    }

    StackedObjectBuffer::StackedObjectBuffer(NugieVulkan::Device *device, VkBufferUsageFlags usageFlags,
                                                   const std::vector<ArrayItemInfo> &arrayItemInfos,
                                                   uint32_t bufferCount)
                        : device{device} 
    {
        this->createBuffers(usageFlags, arrayItemInfos, bufferCount);
    }

    StackedObjectBuffer::~StackedObjectBuffer() {
        for (auto &&buffer: this->buffers) {
            delete buffer;
        }
    }

    void StackedObjectBuffer::createBuffers(VkBufferUsageFlags usageFlags,
                                            const std::vector<ArrayItemInfo> &arrayItemInfos,
                                            uint32_t bufferCount) 
    {
        this->arrayItemBufferInfos.clear();
        this->arrayIdMaps.clear();
        this->buffers.clear();

        VkDeviceSize totalSize = 0u;
        this->arrayItemBufferInfos.reserve(arrayItemInfos.size());

        for (size_t i = 0; i < arrayItemInfos.size(); i++) {
            VkDeviceSize curSize = arrayItemInfos[i].instanceSize * arrayItemInfos[i].count;

            this->arrayItemBufferInfos.emplace_back(ArrayItemBufferInfo{
                    curSize,
                    totalSize
            });

            totalSize += curSize;

            if (!arrayItemInfos[i].arrayId.empty()) {
                this->arrayIdMaps[arrayItemInfos[i].arrayId] = static_cast<int>(i);
            }
        }

        this->buffers.reserve(bufferCount);
        for (uint32_t i = 0; i < bufferCount; i++) {
            auto buffer = new NugieVulkan::Buffer(
                    this->device,
                    totalSize,
                    usageFlags,
                    VMA_MEMORY_USAGE_AUTO_PREFER_HOST,
                    VMA_ALLOCATION_CREATE_HOST_ACCESS_SEQUENTIAL_WRITE_BIT
            );
            
            buffer->map();
            this->buffers.emplace_back(buffer);
        }
    }

    std::vector<VkDescriptorBufferInfo> StackedObjectBuffer::getInfo(uint32_t arrayIndex) {
        std::vector<VkDescriptorBufferInfo> bufferInfos;

        bufferInfos.reserve(this->buffers.size());
        for (auto &&buffer: this->buffers) {
            bufferInfos.emplace_back(buffer->descriptorInfo(this->arrayItemBufferInfos[arrayIndex].size,
                                                            this->arrayItemBufferInfos[arrayIndex].offset));
        }

        return bufferInfos;
    }

    std::vector<VkDescriptorBufferInfo> StackedObjectBuffer::getInfo(const std::string &arrayId) {
        return this->getInfo(this->arrayIdMaps[arrayId]);
    }

    void StackedObjectBuffer::writeValue(uint32_t bufferIndex, uint32_t arrayIndex, void* data) 
    {
        this->buffers[bufferIndex]->writeToBuffer(data, this->arrayItemBufferInfos[arrayIndex].size, this->arrayItemBufferInfos[arrayIndex].offset);
        this->buffers[bufferIndex]->flush(this->arrayItemBufferInfos[arrayIndex].size, this->arrayItemBufferInfos[arrayIndex].offset);
    }

    void StackedObjectBuffer::writeValue(uint32_t bufferIndex, std::string arrayId, void* data) 
    {
        this->writeValue(bufferIndex, this->arrayIdMaps[arrayId], data);
    }

    void StackedObjectBuffer::transitionBuffer(NugieVulkan::CommandBuffer *commandBuffer, uint32_t bufferIndex,
                                                  uint32_t arrayIndex,
                                                  VkPipelineStageFlags srcStage, VkPipelineStageFlags dstStage,
                                                  VkAccessFlags srcAccess, VkAccessFlags dstAccess,
                                                  uint32_t srcQueueFamilyIndex, uint32_t dstQueueFamilyIndex) {
        this->buffers[bufferIndex]->transitionBuffer(commandBuffer, this->arrayItemBufferInfos[arrayIndex].size,
                                                     this->arrayItemBufferInfos[arrayIndex].offset,
                                                     srcStage, dstStage, srcAccess, dstAccess, srcQueueFamilyIndex,
                                                     dstQueueFamilyIndex);
    }

    void StackedObjectBuffer::transitionBuffer(NugieVulkan::CommandBuffer *commandBuffer, uint32_t bufferIndex,
                                                  const std::string &arrayId,
                                                  VkPipelineStageFlags srcStage, VkPipelineStageFlags dstStage,
                                                  VkAccessFlags srcAccess, VkAccessFlags dstAccess,
                                                  uint32_t srcQueueFamilyIndex, uint32_t dstQueueFamilyIndex) {
        this->transitionBuffer(commandBuffer, bufferIndex, this->arrayIdMaps[arrayId], srcStage, dstStage,
                               srcAccess, dstAccess, srcQueueFamilyIndex, dstQueueFamilyIndex);
    }

    void StackedObjectBuffer::initializeValue(NugieVulkan::CommandBuffer *commandBuffer, uint32_t value) {
        for (auto &&buffer: this->buffers) {
            buffer->fillBuffer(commandBuffer, value);
        }
    }
}