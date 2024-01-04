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
	class QuadGraphicRenderSystem {
		public:
			QuadGraphicRenderSystem(NugieVulkan::Device* device, std::vector<NugieVulkan::DescriptorSetLayout*> descriptorSetLayouts, 
				NugieVulkan::RenderPass* renderPass, const std::string &fragFilePath);
			~QuadGraphicRenderSystem();

			void initialize();
			void render(NugieVulkan::CommandBuffer* commandBuffer, const std::vector<VkDescriptorSet> &descriptorSets);
		
		protected:
			virtual void createPipelineLayout();
			virtual void createPipeline();

			NugieVulkan::Device* device;
			
			VkPipelineLayout pipelineLayout;
			NugieVulkan::GraphicPipeline* pipeline;

			std::vector<NugieVulkan::DescriptorSetLayout*> descriptorSetLayouts; 
			NugieVulkan::RenderPass* renderPass;
			std::string fragFilePath;
	};
}