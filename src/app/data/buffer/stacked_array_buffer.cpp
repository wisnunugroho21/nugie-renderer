#include "stacked_array_buffer.hpp"

namespace NugieApp {
  StackedArrayBuffer::Builder::Builder(NugieVulkan::Device* device, VkBufferUsageFlags usageFlags) : device{device}, usageFlags{usageFlags} {
    this->arrayItemInfos.clear();
  }

  StackedArrayBuffer::Builder& StackedArrayBuffer::Builder::addArrayItem(VkDeviceSize instanceSize, uint32_t count) {
    this->arrayItemInfos.emplace_back(ArrayItemInfo{
      instanceSize,
		  count
    });

    return *this;
  }

  StackedArrayBuffer* StackedArrayBuffer::Builder::build() {
    return new StackedArrayBuffer(this->device, this->usageFlags, this->arrayItemInfos);
  }

	StackedArrayBuffer::StackedArrayBuffer(NugieVulkan::Device* device, VkBufferUsageFlags usageFlags, std::vector<ArrayItemInfo> arrayItemInfos) : device{device} {
		this->createBuffers(usageFlags, arrayItemInfos);
	}

	StackedArrayBuffer::~StackedArrayBuffer() {
    if (this->buffer != nullptr) delete this->buffer;
	}

	void StackedArrayBuffer::createBuffers(VkBufferUsageFlags usageFlags, std::vector<ArrayItemInfo> arrayItemInfos) {
    this->arrayItemBufferInfos.clear();

    VkDeviceSize totalSize = 0u;
    
    for (auto&& arrayItemInfo : arrayItemInfos) {
      VkDeviceSize curSize = arrayItemInfo.instanceSize * arrayItemInfo.count;

      this->arrayItemBufferInfos.emplace_back(ArrayItemBufferInfo{
        curSize,
        totalSize
      });

      totalSize += curSize;
    }
    
    
    this->buffer = new NugieVulkan::Buffer(
      this->device,
      totalSize,
      usageFlags,
      VMA_MEMORY_USAGE_AUTO,
      VMA_ALLOCATION_CREATE_DEDICATED_MEMORY_BIT
    );
	}

  VkDescriptorBufferInfo StackedArrayBuffer::getInfo(uint32_t arrayIndex) {
    return buffer->descriptorInfo(this->arrayItemBufferInfos[arrayIndex].size, 
      this->arrayItemBufferInfos[arrayIndex].offset);
  }

  void StackedArrayBuffer::transitionBuffer(NugieVulkan::CommandBuffer* commandBuffer, uint32_t arrayIndex, 
    VkPipelineStageFlags srcStage, VkPipelineStageFlags dstStage, VkAccessFlags srcAccess, VkAccessFlags dstAccess, 
    uint32_t srcQueueFamilyIndex, uint32_t dstQueueFamilyIndex)
  {
    this->buffer->transitionBuffer(commandBuffer, this->arrayItemBufferInfos[arrayIndex].size, this->arrayItemBufferInfos[arrayIndex].offset,
      srcStage, dstStage, srcAccess, dstAccess, srcQueueFamilyIndex, dstQueueFamilyIndex);
  }

	void StackedArrayBuffer::initializeValue(NugieVulkan::CommandBuffer* commandBuffer, uint32_t value) {
    this->buffer->fillBuffer(commandBuffer, value);
	}
}