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
	class TransformationModel {
		public:
			TransformationModel(NugieVulkan::Device* device);
			~TransformationModel();

			VkDescriptorBufferInfo getTransformationInfo() { return this->transformationBuffer->descriptorInfo(); }

			void update(NugieVulkan::CommandBuffer* commandBuffer, std::vector<Transformation> transformations);
			void update(NugieVulkan::CommandBuffer* commandBuffer, std::vector<TransformComponent> transformationComponents);
			
		private:
			NugieVulkan::Device* device;
      
      NugieVulkan::Buffer* transformationStagingBuffer;
			NugieVulkan::Buffer* transformationBuffer;

			std::vector<Transformation> convertToMatrix(std::vector<TransformComponent> transformations);
			void createBuffers();
	};
} // namespace NugieApp
