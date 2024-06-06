#include "stacked_array_buffer.hpp"

namespace NugieApp {
  StackedArrayBuffer::Builder::Builder(NugieVulkan::Device* device, VkBufferUsageFlags usageFlags, uint32_t bufferCount) : device{device}, usageFlags{usageFlags}, bufferCount{bufferCount} {
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
    return new StackedArrayBuffer(this->device, this->usageFlags, this->arrayItemInfos, this->bufferCount);
  }

	StackedArrayBuffer::StackedArrayBuffer(NugieVulkan::Device* device, VkBufferUsageFlags usageFlags, std::vector<ArrayItemInfo> arrayItemInfos, uint32_t bufferCount) : device{device} {
		this->createBuffers(usageFlags, arrayItemInfos, bufferCount);
	}

	StackedArrayBuffer::~StackedArrayBuffer() {
    for (auto &&buffer : this->buffers) {
      if (buffer != nullptr) delete buffer;
    }
	}

	void StackedArrayBuffer::createBuffers(VkBufferUsageFlags usageFlags, std::vector<ArrayItemInfo> arrayItemInfos, uint32_t bufferCount) {
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

  std::vector<VkDescriptorBufferInfo> StackedArrayBuffer::getInfo(uint32_t arrayIndex) {
    std::vector<VkDescriptorBufferInfo> bufferInfos;

    for (auto &&buffer : this->buffers) {
      bufferInfos.emplace_back(buffer->descriptorInfo(this->arrayItemBufferInfos[arrayIndex].size, 
        this->arrayItemBufferInfos[arrayIndex].offset));
    }

    return bufferInfos;
  }

  void StackedArrayBuffer::transitionBuffer(NugieVulkan::CommandBuffer* commandBuffer, uint32_t bufferIndex, uint32_t arrayIndex, 
    VkPipelineStageFlags srcStage, VkPipelineStageFlags dstStage, VkAccessFlags srcAccess, VkAccessFlags dstAccess, 
    uint32_t srcQueueFamilyIndex, uint32_t dstQueueFamilyIndex)
  {
    this->buffers[bufferIndex]->transitionBuffer(commandBuffer, this->arrayItemBufferInfos[arrayIndex].size, this->arrayItemBufferInfos[arrayIndex].offset,
      srcStage, dstStage, srcAccess, dstAccess, srcQueueFamilyIndex, dstQueueFamilyIndex);
  }

	void StackedArrayBuffer::initializeValue(NugieVulkan::CommandBuffer* commandBuffer, uint32_t value) {
    for (auto &&buffer : this->buffers) {
      buffer->fillBuffer(commandBuffer, value);
    }
	}
}