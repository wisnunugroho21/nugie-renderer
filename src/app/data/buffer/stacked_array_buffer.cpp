#include "stacked_array_buffer.hpp"

#include <cassert>

namespace NugieApp {
    StackedArrayBuffer::Builder::Builder(NugieVulkan::Device *device, VkBufferUsageFlags usageFlags, bool isAlsoCreateStaging) 
                                        : device{device}, usageFlags{usageFlags}, isAlsoCreateStaging{isAlsoCreateStaging}
    {
        this->arrayItemInfos.clear();
    }

    StackedArrayBuffer::Builder &
    StackedArrayBuffer::Builder::addArrayItem(const std::string &arrayId, VkDeviceSize instanceSize, uint32_t count) {
        this->arrayItemInfos.emplace_back(ArrayItemInfo{
                arrayId,
                instanceSize,
                count
        });

        return *this;
    }

    StackedArrayBuffer::Builder &StackedArrayBuffer::Builder::addArrayItem(VkDeviceSize instanceSize, uint32_t count) {
        this->arrayItemInfos.emplace_back(ArrayItemInfo{
                "",
                instanceSize,
                count
        });

        return *this;
    }

    StackedArrayBuffer *StackedArrayBuffer::Builder::build() {
        return new StackedArrayBuffer(this->device, this->usageFlags, this->arrayItemInfos, this->isAlsoCreateStaging);
    }

    StackedArrayBuffer::StackedArrayBuffer(NugieVulkan::Device *device, VkBufferUsageFlags usageFlags,
                                           const std::vector<ArrayItemInfo> &arrayItemInfos,
                                           bool isAlsoCreateStaging) 
                                           : device{device}, isAlsoCreateStaging{isAlsoCreateStaging} 
    {
        this->createBuffers(usageFlags, arrayItemInfos);
    }

    StackedArrayBuffer::~StackedArrayBuffer() {
        delete this->buffer;
        delete this->stagingBuffer;
    }

    void StackedArrayBuffer::createBuffers(VkBufferUsageFlags usageFlags, std::vector<ArrayItemInfo> arrayItemInfos) {
        this->arrayItemBufferInfos.clear();
        this->arrayIdMaps.clear();

        VkDeviceSize totalSize = 0u;

        for (size_t i = 0; i < arrayItemInfos.size(); i++) {
            VkDeviceSize curSize = arrayItemInfos[i].instanceSize * arrayItemInfos[i].count;

            this->arrayItemBufferInfos.emplace_back(ArrayItemBufferInfo{
                    curSize,
                    totalSize
            });

            totalSize += curSize;

            if (!arrayItemInfos[i].arrayId.empty()) {
                this->arrayIdMaps[arrayItemInfos[i].arrayId] = i;
            }
        }

        this->buffer = new NugieVulkan::Buffer(
                this->device,
                totalSize,
                usageFlags,
                VMA_MEMORY_USAGE_AUTO,
                VMA_ALLOCATION_CREATE_DEDICATED_MEMORY_BIT
        );

        if (this->isAlsoCreateStaging) {
            this->stagingBuffer = new NugieVulkan::Buffer(
                    this->device,
                    totalSize,
                    usageFlags,
                    VK_BUFFER_USAGE_TRANSFER_SRC_BIT,
                    VMA_MEMORY_USAGE_AUTO,
                    VMA_ALLOCATION_CREATE_HOST_ACCESS_SEQUENTIAL_WRITE_BIT | VMA_ALLOCATION_CREATE_MAPPED_BIT
            );
            
            this->stagingBuffer->map();
        }
    }

    VkDescriptorBufferInfo StackedArrayBuffer::getInfo(uint32_t arrayIndex) {
        return buffer->descriptorInfo(this->arrayItemBufferInfos[arrayIndex].size,
                                      this->arrayItemBufferInfos[arrayIndex].offset);
    }

    VkDescriptorBufferInfo StackedArrayBuffer::getInfo(std::string arrayId) {
        return this->getInfo(this->arrayIdMaps[arrayId]);
    }

    void StackedArrayBuffer::writeValue(NugieVulkan::CommandBuffer *commandBuffer, uint32_t arrayIndex, void* data) {
        assert(this->isAlsoCreateStaging && "staging buffer has not created yet!");

        this->stagingBuffer->writeToBuffer(data, this->arrayItemBufferInfos[arrayIndex].size, this->arrayItemBufferInfos[arrayIndex].offset);
        this->buffer->copyFromAnotherBuffer(commandBuffer, this->stagingBuffer, this->arrayItemBufferInfos[arrayIndex].size, 
                                            this->arrayItemBufferInfos[arrayIndex].offset, this->arrayItemBufferInfos[arrayIndex].offset);
    }

    void StackedArrayBuffer::writeValue(NugieVulkan::CommandBuffer *commandBuffer, std::string arrayId, void* data) {
        this->writeValue(commandBuffer, this->arrayIdMaps[arrayId], data);
    }

    void StackedArrayBuffer::transitionBuffer(NugieVulkan::CommandBuffer *commandBuffer, uint32_t arrayIndex,
                                              VkPipelineStageFlags srcStage, VkPipelineStageFlags dstStage,
                                              VkAccessFlags srcAccess, VkAccessFlags dstAccess,
                                              uint32_t srcQueueFamilyIndex, uint32_t dstQueueFamilyIndex) 
    {
        this->buffer->transitionBuffer(commandBuffer, this->arrayItemBufferInfos[arrayIndex].size,
                                       this->arrayItemBufferInfos[arrayIndex].offset,
                                       srcStage, dstStage, srcAccess, dstAccess, srcQueueFamilyIndex,
                                       dstQueueFamilyIndex);
    }

    void StackedArrayBuffer::transitionBuffer(NugieVulkan::CommandBuffer *commandBuffer, std::string arrayId,
                                              VkPipelineStageFlags srcStage, VkPipelineStageFlags dstStage,
                                              VkAccessFlags srcAccess, VkAccessFlags dstAccess,
                                              uint32_t srcQueueFamilyIndex, uint32_t dstQueueFamilyIndex) 
    {
        this->transitionBuffer(commandBuffer, this->arrayIdMaps[arrayId], srcStage, dstStage,
                               srcAccess, dstAccess, srcQueueFamilyIndex, dstQueueFamilyIndex);
    }

    void StackedArrayBuffer::initializeValue(NugieVulkan::CommandBuffer *commandBuffer, uint32_t value) {
        this->buffer->fillBuffer(commandBuffer, value);
    }
}