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
#include <string>

namespace NugieApp {
	class GraphicRenderSystem {
		public:
			GraphicRenderSystem(NugieVulkan::Device* device, std::vector<NugieVulkan::DescriptorSetLayout*> descriptorSetLayouts, 
				NugieVulkan::RenderPass* renderPass, const std::string& vertFilePath, const std::string& fragFilePath);
			~GraphicRenderSystem();

			void initialize();
			virtual void render(NugieVulkan::CommandBuffer* commandBuffer, const std::vector<VkDescriptorSet> &descriptorSets, 
				const std::vector<NugieVulkan::Buffer*> &vertexBuffers, NugieVulkan::Buffer* indexBuffer, uint32_t indexCount,
				const std::vector<VkDeviceSize> &vertexOffsets = {}, VkDeviceSize indexOffset = 0);
		
		protected:
			virtual void createPipelineLayout();
			virtual void createPipeline();
		
			NugieVulkan::Device* device = nullptr;
			
			VkPipelineLayout pipelineLayout;
			NugieVulkan::GraphicPipeline* pipeline = nullptr;

			std::vector<NugieVulkan::DescriptorSetLayout*> descriptorSetLayouts; 
			NugieVulkan::RenderPass* renderPass = nullptr;
			std::string vertFilePath, fragFilePath;
	};
}