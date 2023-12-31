#pragma once

#include "../../vulkan/device/device.hpp"
#include "../../vulkan/buffer/buffer.hpp"
#include "../../vulkan/command/command_buffer.hpp"
#include "../../vulkan/descriptor/descriptor_set_layout.hpp"
#include "../../vulkan/pipeline/graphic_pipeline.hpp"
#include "../../vulkan/renderpass/renderpass.hpp"

#include "../general_struct.hpp"

#include <vector>

namespace NugieApp {
	class FinalPassRenderSystem {
		public:
			FinalPassRenderSystem(NugieVulkan::Device* device, NugieVulkan::DescriptorSetLayout* descriptorSetLayout, NugieVulkan::RenderPass* renderPass);
			~FinalPassRenderSystem();

			void render(NugieVulkan::CommandBuffer* commandBuffer, VkDescriptorSet descriptorSets);
		
		private:
			void createPipelineLayout(NugieVulkan::DescriptorSetLayout* descriptorSetLayout);
			void createPipeline(NugieVulkan::RenderPass* renderPass);

			NugieVulkan::Device* device;
			
			VkPipelineLayout pipelineLayout;
			NugieVulkan::GraphicPipeline* pipeline;
	};
}