#include "stacked_array_many_buffer.hpp"

namespace NugieApp {
    StackedArrayManyBuffer::Builder::Builder(NugieVulkan::Device *device, VkBufferUsageFlags usageFlags,
                                             uint32_t bufferCount) : device{device}, usageFlags{usageFlags},
                                                                     bufferCount{bufferCount} {
        this->arrayItemInfos.clear();
    }

    StackedArrayManyBuffer::Builder &
    StackedArrayManyBuffer::Builder::addArrayItem(VkDeviceSize instanceSize, uint32_t count) {
        this->arrayItemInfos.emplace_back(ArrayItemInfo{
                "",
                instanceSize,
                count
        });

        return *this;
    }

    StackedArrayManyBuffer::Builder &
    StackedArrayManyBuffer::Builder::addArrayItem(const std::string &id, VkDeviceSize instanceSize, uint32_t count) {
        this->arrayItemInfos.emplace_back(ArrayItemInfo{
                id,
                instanceSize,
                count
        });

        return *this;
    }

    StackedArrayManyBuffer *StackedArrayManyBuffer::Builder::build() {
        return new StackedArrayManyBuffer(this->device, this->usageFlags, this->arrayItemInfos, this->bufferCount);
    }

    StackedArrayManyBuffer::StackedArrayManyBuffer(NugieVulkan::Device *device, VkBufferUsageFlags usageFlags,
                                                   const std::vector<ArrayItemInfo> &arrayItemInfos,
                                                   uint32_t bufferCount)
            : device{device} {
        this->createBuffers(usageFlags, arrayItemInfos, bufferCount);
    }

    StackedArrayManyBuffer::~StackedArrayManyBuffer() {
        for (auto &&buffer: this->buffers) {
            delete buffer;
        }
    }

    void StackedArrayManyBuffer::createBuffers(VkBufferUsageFlags usageFlags,
                                               const std::vector<ArrayItemInfo> &arrayItemInfos,
                                               uint32_t bufferCount) {
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
            this->buffers.emplace_back(new NugieVulkan::Buffer(
                    this->device,
                    totalSize,
                    usageFlags,
                    VMA_MEMORY_USAGE_AUTO,
                    VMA_ALLOCATION_CREATE_DEDICATED_MEMORY_BIT
            ));
        }
    }

    std::vector<VkDescriptorBufferInfo> StackedArrayManyBuffer::getInfo(uint32_t arrayIndex) {
        std::vector<VkDescriptorBufferInfo> bufferInfos;

        bufferInfos.reserve(this->buffers.size());
        for (auto &&buffer: this->buffers) {
            bufferInfos.emplace_back(buffer->descriptorInfo(this->arrayItemBufferInfos[arrayIndex].size,
                                                            this->arrayItemBufferInfos[arrayIndex].offset));
        }

        return bufferInfos;
    }

    std::vector<VkDescriptorBufferInfo> StackedArrayManyBuffer::getInfo(const std::string &arrayId) {
        return this->getInfo(this->arrayIdMaps[arrayId]);
    }

    void StackedArrayManyBuffer::transitionBuffer(NugieVulkan::CommandBuffer *commandBuffer, uint32_t bufferIndex,
                                                  uint32_t arrayIndex,
                                                  VkPipelineStageFlags srcStage, VkPipelineStageFlags dstStage,
                                                  VkAccessFlags srcAccess, VkAccessFlags dstAccess,
                                                  uint32_t srcQueueFamilyIndex, uint32_t dstQueueFamilyIndex) {
        this->buffers[bufferIndex]->transitionBuffer(commandBuffer, this->arrayItemBufferInfos[arrayIndex].size,
                                                     this->arrayItemBufferInfos[arrayIndex].offset,
                                                     srcStage, dstStage, srcAccess, dstAccess, srcQueueFamilyIndex,
                                                     dstQueueFamilyIndex);
    }

    void StackedArrayManyBuffer::transitionBuffer(NugieVulkan::CommandBuffer *commandBuffer, uint32_t bufferIndex,
                                                  const std::string &arrayId,
                                                  VkPipelineStageFlags srcStage, VkPipelineStageFlags dstStage,
                                                  VkAccessFlags srcAccess, VkAccessFlags dstAccess,
                                                  uint32_t srcQueueFamilyIndex, uint32_t dstQueueFamilyIndex) {
        this->transitionBuffer(commandBuffer, bufferIndex, this->arrayIdMaps[arrayId], srcStage, dstStage,
                               srcAccess, dstAccess, srcQueueFamilyIndex, dstQueueFamilyIndex);
    }

    void StackedArrayManyBuffer::initializeValue(NugieVulkan::CommandBuffer *commandBuffer, uint32_t value) {
        for (auto &&buffer: this->buffers) {
            buffer->fillBuffer(commandBuffer, value);
        }
    }
}