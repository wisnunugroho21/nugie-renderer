#include "stacked_array_many_buffer.hpp"

#include <cassert>

namespace NugieApp {
    StackedArrayManyBuffer::Builder::Builder(NugieVulkan::Device *device, VkBufferUsageFlags usageFlags,
                                             uint32_t bufferCount, bool isAlsoCreateStaging) 
                                    : device{device}, usageFlags{usageFlags}, bufferCount{bufferCount}, 
                                      isAlsoCreateStaging{isAlsoCreateStaging}
    {
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
        return new StackedArrayManyBuffer(this->device, this->usageFlags, this->arrayItemInfos, this->bufferCount, this->isAlsoCreateStaging);
    }

    StackedArrayManyBuffer::StackedArrayManyBuffer(NugieVulkan::Device *device, VkBufferUsageFlags usageFlags,
                                                   const std::vector<ArrayItemInfo> &arrayItemInfos,
                                                   uint32_t bufferCount, bool isAlsoCreateStaging)
                                                   : device{device}, isAlsoCreateStaging{isAlsoCreateStaging} 
    {
        this->createBuffers(usageFlags, arrayItemInfos, bufferCount);
    }

    StackedArrayManyBuffer::~StackedArrayManyBuffer() {
        for (auto &&buffer: this->buffers) {
            delete buffer;
        }
    }

    void StackedArrayManyBuffer::createBuffers(VkBufferUsageFlags usageFlags,
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
        if (this->isAlsoCreateStaging) 
            this->stagingBuffers.reserve(bufferCount);

        for (uint32_t i = 0; i < bufferCount; i++) {
            this->buffers.emplace_back(new NugieVulkan::Buffer(
                    this->device,
                    totalSize,
                    usageFlags,
                    VMA_MEMORY_USAGE_AUTO,
                    VMA_ALLOCATION_CREATE_DEDICATED_MEMORY_BIT
            ));

            if (this->isAlsoCreateStaging) {
                auto stagingBuffer = new NugieVulkan::Buffer(
                        this->device,
                        totalSize,
                        usageFlags,
                        VK_BUFFER_USAGE_TRANSFER_SRC_BIT,
                        VMA_MEMORY_USAGE_AUTO,
                        VMA_ALLOCATION_CREATE_HOST_ACCESS_SEQUENTIAL_WRITE_BIT | VMA_ALLOCATION_CREATE_MAPPED_BIT
                );
                
                stagingBuffer->map();
                this->stagingBuffers.emplace_back(stagingBuffer);
            
            }
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

    void StackedArrayManyBuffer::writeValue(NugieVulkan::CommandBuffer *commandBuffer, uint32_t bufferIndex, uint32_t arrayIndex, 
                                            void* data) 
    {
        assert(this->isAlsoCreateStaging && "staging buffer has not created yet!");

        this->stagingBuffers[bufferIndex]->writeToBuffer(data, this->arrayItemBufferInfos[arrayIndex].size, this->arrayItemBufferInfos[arrayIndex].offset);
        this->buffers[bufferIndex]->copyFromAnotherBuffer(commandBuffer, this->stagingBuffers[bufferIndex], this->arrayItemBufferInfos[arrayIndex].size, 
                                            this->arrayItemBufferInfos[arrayIndex].offset, this->arrayItemBufferInfos[arrayIndex].offset);
    }

    void StackedArrayManyBuffer::writeValue(NugieVulkan::CommandBuffer *commandBuffer, uint32_t bufferIndex, std::string arrayId, 
                                            void* data) 
    {
        this->writeValue(commandBuffer, bufferIndex, this->arrayIdMaps[arrayId], data);
    }

    void StackedArrayManyBuffer::transitionBuffer(NugieVulkan::CommandBuffer *commandBuffer, uint32_t bufferIndex,
                                                  uint32_t arrayIndex,
                                                  VkPipelineStageFlags srcStage, VkPipelineStageFlags dstStage,
                                                  VkAccessFlags srcAccess, VkAccessFlags dstAccess,
                                                  uint32_t srcQueueFamilyIndex, uint32_t dstQueueFamilyIndex) 
    {
        this->buffers[bufferIndex]->transitionBuffer(commandBuffer, this->arrayItemBufferInfos[arrayIndex].size,
                                                     this->arrayItemBufferInfos[arrayIndex].offset,
                                                     srcStage, dstStage, srcAccess, dstAccess, srcQueueFamilyIndex,
                                                     dstQueueFamilyIndex);
    }

    void StackedArrayManyBuffer::transitionBuffer(NugieVulkan::CommandBuffer *commandBuffer, uint32_t bufferIndex,
                                                  const std::string &arrayId,
                                                  VkPipelineStageFlags srcStage, VkPipelineStageFlags dstStage,
                                                  VkAccessFlags srcAccess, VkAccessFlags dstAccess,
                                                  uint32_t srcQueueFamilyIndex, uint32_t dstQueueFamilyIndex) 
    {
        this->transitionBuffer(commandBuffer, bufferIndex, this->arrayIdMaps[arrayId], srcStage, dstStage,
                               srcAccess, dstAccess, srcQueueFamilyIndex, dstQueueFamilyIndex);
    }

    void StackedArrayManyBuffer::transitionBuffer(NugieVulkan::CommandBuffer *commandBuffer, uint32_t bufferIndex, 
                                                  const std::vector<std::string> &arrayIds,
                                                  VkPipelineStageFlags srcStage, VkPipelineStageFlags dstStage, 
                                                  VkAccessFlags srcAccess, VkAccessFlags dstAccess,
                                                  uint32_t srcQueueFamilyIndex, uint32_t dstQueueFamilyIndex) 
    {
        int prevIndex = this->arrayIdMaps[
            arrayIds[0]
        ];

        for (size_t i = 1; i < arrayIds.size(); i++) {
            int curIndex = this->arrayIdMaps[
                arrayIds[i]
            ];

            if (curIndex - 1 != prevIndex) {
                throw std::runtime_error("some id(s) did not sits in the correct order");
            }

            prevIndex = curIndex;
        }

        VkDeviceSize offset = this->arrayItemBufferInfos[
            this->arrayIdMaps[
                arrayIds[0]
            ]
        ].offset;

        VkDeviceSize size = this->arrayItemBufferInfos[
            this->arrayIdMaps[
                arrayIds[0]
            ]
        ].size;

        for (size_t i = 1; i < arrayIds.size(); i++) {
            size += this->arrayItemBufferInfos[
                this->arrayIdMaps[
                    arrayIds[i]
                ]
            ].size;
        }
        
        this->buffers[bufferIndex]->transitionBuffer(commandBuffer, size, offset, srcStage, dstStage, 
                                                     srcAccess, dstAccess, srcQueueFamilyIndex,
                                                     dstQueueFamilyIndex);

    }

    void StackedArrayManyBuffer::initializeValue(NugieVulkan::CommandBuffer *commandBuffer, uint32_t value) {
        for (auto &&buffer: this->buffers) {
            buffer->fillBuffer(commandBuffer, value);
        }
    }
}