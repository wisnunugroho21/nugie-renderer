#include "stacked_array_many_buffer.hpp"

namespace NugieApp {
  StackedArrayManyBuffer::Builder::Builder(NugieVulkan::Device* device, VkBufferUsageFlags usageFlags, uint32_t bufferCount) : device{device}, usageFlags{usageFlags}, bufferCount{bufferCount} {
    this->arrayItemInfos.clear();
  }

  StackedArrayManyBuffer::Builder& StackedArrayManyBuffer::Builder::addArrayItem(VkDeviceSize instanceSize, uint32_t count) {
    this->arrayItemInfos.emplace_back(ArrayItemInfo{
      instanceSize,
		  count
    });

    return *this;
  }

  StackedArrayManyBuffer* StackedArrayManyBuffer::Builder::build() {
    return new StackedArrayManyBuffer(this->device, this->usageFlags, this->arrayItemInfos, this->bufferCount);
  }

	StackedArrayManyBuffer::StackedArrayManyBuffer(NugieVulkan::Device* device, VkBufferUsageFlags usageFlags, std::vector<ArrayItemInfo> arrayItemInfos, uint32_t bufferCount) : device{device} {
		this->createBuffers(usageFlags, arrayItemInfos, bufferCount);
	}

	StackedArrayManyBuffer::~StackedArrayManyBuffer() {
    for (auto &&buffer : this->buffers) {
      if (buffer != nullptr) delete buffer;
    }
	}

	void StackedArrayManyBuffer::createBuffers(VkBufferUsageFlags usageFlags, std::vector<ArrayItemInfo> arrayItemInfos, uint32_t bufferCount) {
    this->arrayItemBufferInfos.clear();
    this->buffers.clear();

    VkDeviceSize totalSize = 0u;
    
    for (auto&& arrayItemInfo : arrayItemInfos) {
      VkDeviceSize curSize = arrayItemInfo.instanceSize * arrayItemInfo.count;

      this->arrayItemBufferInfos.emplace_back(ArrayItemBufferInfo{
        curSize,
        totalSize
      });

      totalSize += curSize;
    }
    
    
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

    for (auto &&buffer : this->buffers) {
      bufferInfos.emplace_back(buffer->descriptorInfo(this->arrayItemBufferInfos[arrayIndex].size, 
        this->arrayItemBufferInfos[arrayIndex].offset));
    }

    return bufferInfos;
  }

  void StackedArrayManyBuffer::transitionBuffer(NugieVulkan::CommandBuffer* commandBuffer, uint32_t bufferIndex, uint32_t arrayIndex, 
    VkPipelineStageFlags srcStage, VkPipelineStageFlags dstStage, VkAccessFlags srcAccess, VkAccessFlags dstAccess, 
    uint32_t srcQueueFamilyIndex, uint32_t dstQueueFamilyIndex)
  {
    this->buffers[bufferIndex]->transitionBuffer(commandBuffer, this->arrayItemBufferInfos[arrayIndex].size, this->arrayItemBufferInfos[arrayIndex].offset,
      srcStage, dstStage, srcAccess, dstAccess, srcQueueFamilyIndex, dstQueueFamilyIndex);
  }

	void StackedArrayManyBuffer::initializeValue(NugieVulkan::CommandBuffer* commandBuffer, uint32_t value) {
    for (auto &&buffer : this->buffers) {
      buffer->fillBuffer(commandBuffer, value);
    }
	}
}