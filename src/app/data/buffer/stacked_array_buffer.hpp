#pragma once

#include "../../../vulkan/device/device.hpp"
#include "../../../vulkan/buffer/buffer.hpp"
#include "../../../vulkan/command/command_buffer.hpp"

#include <vector>
#include <memory>

namespace NugieApp {
	struct ArrayItemInfo {
		VkDeviceSize instanceSize = 0u;
		uint32_t count = 0u;
	};

	struct ArrayItemBufferInfo {
		VkDeviceSize size = 0u;
		VkDeviceSize offset = 0u;
	};
	
	class StackedArrayBuffer {
		public:
			class Builder {
				public:
					Builder(NugieVulkan::Device* device, VkBufferUsageFlags usageFlags, uint32_t bufferCount);
					Builder& addArrayItem(VkDeviceSize instanceSize, uint32_t count);

					StackedArrayBuffer* build();

				private:
					NugieVulkan::Device* device = nullptr;
					VkBufferUsageFlags usageFlags;
					
					std::vector<ArrayItemInfo> arrayItemInfos;
					uint32_t bufferCount;
			};

			StackedArrayBuffer(NugieVulkan::Device* device, VkBufferUsageFlags usageFlags, std::vector<ArrayItemInfo> arrayItemInfos, uint32_t bufferCount);
			~StackedArrayBuffer();

			NugieVulkan::Buffer* getBuffer(uint32_t bufferIndex) const { return this->buffers[bufferIndex]; }

			std::vector<VkDescriptorBufferInfo> getInfo(uint32_t arrayIndex);
			void transitionBuffer(NugieVulkan::CommandBuffer* commandBuffer, uint32_t bufferIndex, uint32_t arrayIndex, 
				VkPipelineStageFlags srcStage, VkPipelineStageFlags dstStage, VkAccessFlags srcAccess, VkAccessFlags dstAccess, 
				uint32_t srcQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED, uint32_t dstQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED);
			

			void initializeValue(NugieVulkan::CommandBuffer* commandBuffer, uint32_t value = 0u);
			
		private:
			NugieVulkan::Device* device = nullptr;

			std::vector<NugieVulkan::Buffer*> buffers;
			std::vector<ArrayItemBufferInfo> arrayItemBufferInfos;

			void createBuffers(VkBufferUsageFlags usageFlags, std::vector<ArrayItemInfo> arrayItemInfos, uint32_t bufferCount);
	};

	
} // namespace NugieApp
