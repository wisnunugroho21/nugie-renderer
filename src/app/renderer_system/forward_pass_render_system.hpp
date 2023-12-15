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
	class ForwardPassRenderSystem {
		public:
			ForwardPassRenderSystem(NugieVulkan::Device* device, NugieVulkan::DescriptorSetLayout* descriptorSetLayout, NugieVulkan::RenderPass* renderPass);
			~ForwardPassRenderSystem();

			void render(NugieVulkan::CommandBuffer* commandBuffer, VkDescriptorSet descriptorSets, 
				const std::vector<NugieVulkan::Buffer*> &vertexBuffers, NugieVulkan::Buffer* indexBuffer, 
				uint32_t indexCount, std::vector<VkDeviceSize> offsets = {});
		
		private:
			void createPipelineLayout(NugieVulkan::DescriptorSetLayout* descriptorSetLayout);
			void createPipeline(NugieVulkan::RenderPass* renderPass);

			NugieVulkan::Device* device;
			
			VkPipelineLayout pipelineLayout;
			NugieVulkan::GraphicPipeline* pipeline;
	};
}