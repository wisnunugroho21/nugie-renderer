#pragma once

#include "../../object/command/command_buffer.hpp"
#include "../../object/device/device.hpp"
#include "../../object/pipeline/compute_pipeline.hpp"
#include "../../object/buffer/buffer.hpp"
#include "../../object/descriptor/descriptor_set_layout.hpp"

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
		
		private:
			virtual void createPipelineLayout();
			virtual void createPipeline();

			NugieVulkan::Device* device = nullptr;
			
			VkPipelineLayout pipelineLayout;
			NugieVulkan::ComputePipeline* pipeline = nullptr;

			std::vector<NugieVulkan::DescriptorSetLayout*> descriptorSetLayouts; 
			std::string compFilePath;
	};
}