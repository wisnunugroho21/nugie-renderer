#pragma once

#include "../../../vulkan/device/device.hpp"
#include "../../../vulkan/buffer/buffer.hpp"
#include "../../../vulkan/command/command_buffer.hpp"
#include "../../general_struct.hpp"
#include "../../utils/transform/transform.hpp"

#define GLM_FORCE_RADIANS
#define GLM_FORCE_DEPTH_ZERO_TO_ONE
#include <glm/glm.hpp>

#include <vector>
#include <memory>

namespace NugieApp {
	class LightTransformationModel {
		public:
			LightTransformationModel(NugieVulkan::Device* device);
			~LightTransformationModel();

			VkDescriptorBufferInfo getTransformationInfo() { return this->lightTransformationBuffer->descriptorInfo(); }

			void update(NugieVulkan::CommandBuffer* commandBuffer, std::vector<LightTransformation> lightTransformations);
			
		private:
			NugieVulkan::Device* device;
      
      NugieVulkan::Buffer* lightTransformationStagingBuffer;
			NugieVulkan::Buffer* lightTransformationBuffer;

			void createBuffers();
	};
} // namespace NugieApp
