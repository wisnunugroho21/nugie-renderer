#pragma once

#include "../../vulkan/command/command_buffer.hpp"
#include "../../vulkan/device/device.hpp"
#include "../../vulkan/pipeline/compute_pipeline.hpp"
#include "../../vulkan/buffer/buffer.hpp"
#include "../../vulkan/descriptor/descriptor_set_layout.hpp"

#include "../general_struct.hpp"

#include <vector>

namespace NugieApp {
	class ComputeRenderSystem {
		public:
			ComputeRenderSystem(NugieVulkan::Device* device, const std::vector<NugieVulkan::DescriptorSetLayout*> &descriptorSetLayouts, std::string compFilePath);
			~ComputeRenderSystem();
			
			void initialize();
			virtual void render(NugieVulkan::CommandBuffer* commandBuffer, const std::vector<VkDescriptorSet> &descriptorSets, 
				uint32_t xInvocations, uint32_t yInvocations, uint32_t zInvocations);
		
		protected:
			virtual void createPipelineLayout();
			virtual void createPipeline();

			NugieVulkan::Device* device = nullptr;
			
			VkPipelineLayout pipelineLayout;
			NugieVulkan::ComputePipeline* pipeline = nullptr;

			std::vector<NugieVulkan::DescriptorSetLayout*> descriptorSetLayouts; 
			std::string compFilePath;
	};
}