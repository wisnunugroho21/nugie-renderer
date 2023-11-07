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
	class PositionModel {
		public:
			PositionModel(NugieVulkan::Device* device);
			~PositionModel();

			VkDescriptorBufferInfo getPositionInfo() { return this->buffer->descriptorInfo(); }
			NugieVulkan::Buffer* getBuffer() { return this->buffer; }

			void update(NugieVulkan::CommandBuffer* commandBuffer, std::vector<glm::vec4> positions);
			
		private:
			NugieVulkan::Device* device;

			NugieVulkan::Buffer* stagingBuffer;
			NugieVulkan::Buffer* buffer;

			void createBuffers();
	};
} // namespace NugieApp
