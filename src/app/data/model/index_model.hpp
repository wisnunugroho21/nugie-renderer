#pragma once

#include "../../../vulkan/device/device.hpp"
#include "../../../vulkan/buffer/buffer.hpp"
#include "../../../vulkan/command/command_buffer.hpp"
#include "../../general_struct.hpp"

#define GLM_FORCE_RADIANS
#define GLM_FORCE_DEPTH_ZERO_TO_ONE
#include <glm/glm.hpp>

#include <vector>
#include <memory>

namespace NugieApp {
	class IndexModel {
		public:
			IndexModel(NugieVulkan::Device* device);
			~IndexModel();

			VkDescriptorBufferInfo getIndexInfo() { return this->buffer->descriptorInfo(); }
			NugieVulkan::Buffer* getBuffer() { return this->buffer; }
			uint32_t getIndexCount() { return this->indexCount; }
		
			void update(NugieVulkan::CommandBuffer* commandBuffer, std::vector<uint32_t> indices);
			
		private:
			NugieVulkan::Device* device;

			NugieVulkan::Buffer* stagingBuffer;
			NugieVulkan::Buffer* buffer;
			uint32_t indexCount;

			void createBuffers();
	};
} // namespace NugieApp
