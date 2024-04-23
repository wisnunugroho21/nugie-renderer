#pragma once

#include "../device/device.hpp"
#include "../image/image.hpp"
#include "../command/command_buffer.hpp"
#include "../command/command_pool.hpp"

#include <memory>
 
namespace NugieVulkan {
  class Image;
 
  class Buffer {
  public:
    Buffer(
      Device* device,
      VkDeviceSize instanceSize,
      uint32_t instanceCount,
      VkBufferUsageFlags usageFlags,
      VmaMemoryUsage memoryUsage, 
      VmaAllocationCreateFlags memoryAllocFlag,
      VkDeviceSize minOffsetAlignment = 1);

    ~Buffer();

    VkBuffer getBuffer() const { return this->buffer; }
    void* getMappedMemory() const { return this->mapped; }
    uint32_t getInstanceCount() const { return this->instanceCount; }
    VkDeviceSize getInstanceSize() const { return this->instanceSize; }
    VkDeviceSize getAlignmentSize() const { return this->instanceSize; }
    VkDeviceSize getBufferSize() const { return this->bufferSize; }
    VkBufferUsageFlags getUsageFlags() const { return this->usageFlags; }
    VmaAllocation getMemoryAllocation() const { return this->memoryAllocation; }

    void createBuffer(VkDeviceSize size, VkBufferUsageFlags usage, VmaMemoryUsage memoryUsage, VmaAllocationCreateFlags memoryAllocFlag);

    void copyFromAnotherBuffer(CommandBuffer* commandBuffer, Buffer* srcBuffer, VkDeviceSize size = VK_WHOLE_SIZE, VkDeviceSize srcOffset = 0, VkDeviceSize dstOffset = 0);
    void copyToAnotherBuffer(CommandBuffer* commandBuffer,Buffer* destBuffer, VkDeviceSize size = VK_WHOLE_SIZE, VkDeviceSize srcOffset = 0, VkDeviceSize dstOffset = 0);
    void copyBufferToImage(CommandBuffer* commandBuffer, Image* destImage, uint32_t srcOffset = 0, uint32_t dstMipLevel = 0, uint32_t dstLayer = 0);
    void copyImageToBuffer(CommandBuffer* commandBuffer, Image* srcImage, uint32_t dstOffset = 0, uint32_t srcMipLevel = 0, uint32_t srcLayer = 0);
  
    VkResult map(VkDeviceSize size = VK_WHOLE_SIZE, VkDeviceSize offset = 0);
    void unmap();
  
    void writeToBuffer(void* data, VkDeviceSize size = VK_WHOLE_SIZE, VkDeviceSize offset = 0);
    void readFromBuffer(void* data, VkDeviceSize size = VK_WHOLE_SIZE, VkDeviceSize offset = 0);
    VkResult flush(VkDeviceSize size = VK_WHOLE_SIZE, VkDeviceSize offset = 0);
    VkDescriptorBufferInfo descriptorInfo(VkDeviceSize size = VK_WHOLE_SIZE, VkDeviceSize offset = 0);
    VkResult invalidate(VkDeviceSize size = VK_WHOLE_SIZE, VkDeviceSize offset = 0);
  
    void writeToIndex(void* data, int index);
    void readFromIndex(void* data, int index);
    VkResult flushIndex(int index);
    VkResult invalidateIndex(int index);
    VkDescriptorBufferInfo descriptorInfoForIndex(int index);

    void transitionBuffer(CommandBuffer* commandBuffer, VkPipelineStageFlags srcStage, VkPipelineStageFlags dstStage, 
      VkAccessFlags srcAccess, VkAccessFlags dstAccess, uint32_t srcQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED, 
      uint32_t dstQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED);

    static void transitionBuffer(CommandBuffer* commandBuffer, const std::vector<Buffer*> &buffers, VkPipelineStageFlags srcStage, VkPipelineStageFlags dstStage, 
      VkAccessFlags srcAccess, VkAccessFlags dstAccess, uint32_t srcQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED, 
      uint32_t dstQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED);
  
  private:
    static VkDeviceSize getAlignment(VkDeviceSize instanceSize, VkDeviceSize minOffsetAlignment);
  
    Device* device = nullptr;

    void* mapped = nullptr;
    VkBuffer buffer;
  
    VkDeviceSize bufferSize;
    uint32_t instanceCount;
    VkDeviceSize instanceSize;
    VkDeviceSize alignmentSize;
    VkBufferUsageFlags usageFlags;
    VmaAllocation memoryAllocation;
  };
 
}  // namespace lve