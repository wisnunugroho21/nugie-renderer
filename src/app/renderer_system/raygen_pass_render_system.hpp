#pragma once

#include "../../vulkan/device/device.hpp"
#include "../../vulkan/buffer/buffer.hpp"
#include "../../vulkan/command/command_buffer.hpp"
#include "../../vulkan/descriptor/descriptor_set_layout.hpp"
#include "../../vulkan/pipeline/compute_pipeline.hpp"

#include "../general_struct.hpp"

#include <vector>

namespace NugieApp {
	class RayGenPassRenderSystem {
		public:
			RayGenPassRenderSystem(NugieVulkan::Device* device, const std::vector<NugieVulkan::DescriptorSetLayout*> &descriptorSetLayouts, uint32_t width, uint32_t height, uint32_t nSample);
			~RayGenPassRenderSystem();

			void render(NugieVulkan::CommandBuffer* commandBuffer, const std::vector<VkDescriptorSet> &descriptorSets);
		
		private:
			void createPipelineLayout(const std::vector<NugieVulkan::DescriptorSetLayout*> &descriptorSetLayouts);
			void createPipeline();

			NugieVulkan::Device* device;
      uint32_t width, height, nSample;
			
			VkPipelineLayout pipelineLayout;
			NugieVulkan::ComputePipeline* pipeline;
	};
}