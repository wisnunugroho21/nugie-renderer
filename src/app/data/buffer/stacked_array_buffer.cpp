#include "stacked_array_buffer.hpp"

namespace NugieApp {
  StackedArrayBuffer::Builder::Builder(NugieVulkan::Device* device, VkBufferUsageFlags usageFlags) : device{device}, usageFlags{usageFlags} {
    this->arrayItemInfos.clear();
  }

  StackedArrayBuffer::Builder& StackedArrayBuffer::Builder::addArrayItem(std::string arrayId, VkDeviceSize instanceSize, uint32_t count) {
    this->arrayItemInfos.emplace_back(ArrayItemInfo{
      arrayId,
      instanceSize,
		  count
    });

    return *this;
  }

  StackedArrayBuffer::Builder& StackedArrayBuffer::Builder::addArrayItem(VkDeviceSize instanceSize, uint32_t count) {
    this->arrayItemInfos.emplace_back(ArrayItemInfo{
      "",
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
	}

  VkDescriptorBufferInfo StackedArrayBuffer::getInfo(uint32_t arrayIndex) {
    return buffer->descriptorInfo(this->arrayItemBufferInfos[arrayIndex].size, 
      this->arrayItemBufferInfos[arrayIndex].offset);
  }

  VkDescriptorBufferInfo StackedArrayBuffer::getInfo(std::string arrayId) {
    return this->getInfo(this->arrayIdMaps[arrayId]);
  }

  void StackedArrayBuffer::transitionBuffer(NugieVulkan::CommandBuffer* commandBuffer, uint32_t arrayIndex, 
    VkPipelineStageFlags srcStage, VkPipelineStageFlags dstStage, VkAccessFlags srcAccess, VkAccessFlags dstAccess, 
    uint32_t srcQueueFamilyIndex, uint32_t dstQueueFamilyIndex)
  {
    this->buffer->transitionBuffer(commandBuffer, this->arrayItemBufferInfos[arrayIndex].size, this->arrayItemBufferInfos[arrayIndex].offset,
      srcStage, dstStage, srcAccess, dstAccess, srcQueueFamilyIndex, dstQueueFamilyIndex);
  }

  void StackedArrayBuffer::transitionBuffer(NugieVulkan::CommandBuffer* commandBuffer, std::string arrayId,
    VkPipelineStageFlags srcStage, VkPipelineStageFlags dstStage, VkAccessFlags srcAccess, VkAccessFlags dstAccess, 
    uint32_t srcQueueFamilyIndex, uint32_t dstQueueFamilyIndex)
  {
    this->transitionBuffer(commandBuffer, this->arrayIdMaps[arrayId], srcStage, dstStage, 
      srcAccess, dstAccess, srcQueueFamilyIndex, dstQueueFamilyIndex);
  }

	void StackedArrayBuffer::initializeValue(NugieVulkan::CommandBuffer* commandBuffer, uint32_t value) {
    this->buffer->fillBuffer(commandBuffer, value);
	}
}