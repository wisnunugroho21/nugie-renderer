#pragma once

#include "../../vulkan/command/command_buffer.hpp"
#include "../../vulkan/device/device.hpp"
#include "../../vulkan/pipeline/graphic_pipeline.hpp"
#include "../../vulkan/buffer/buffer.hpp"
#include "../../vulkan/descriptor/descriptor_set_layout.hpp"
#include "../../vulkan/swap_chain/swap_chain.hpp"
#include "../../vulkan/renderpass/renderpass.hpp"

#include "../general_struct.hpp"

#include <vector>

namespace NugieApp {
	class DeferredPassRenderSystem {
		public:
			DeferredPassRenderSystem(NugieVulkan::Device* device, std::vector<NugieVulkan::DescriptorSetLayout*> descriptorSetLayouts, 
				NugieVulkan::RenderPass* renderPass);
			~DeferredPassRenderSystem();

			void render(NugieVulkan::CommandBuffer* commandBuffer, std::vector<VkDescriptorSet> descriptorSets, float farPlane = 0.0f);
		
		private:
			void createPipelineLayout(std::vector<NugieVulkan::DescriptorSetLayout*> descriptorSetLayouts);
			void createPipeline(NugieVulkan::RenderPass* renderPass);

			NugieVulkan::Device* device;
			
			VkPipelineLayout pipelineLayout;
			NugieVulkan::GraphicPipeline* pipeline;
	};
}