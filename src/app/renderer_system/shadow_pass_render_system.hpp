#pragma once

#include "graphic_render_system.hpp"

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
	class ShadowPassRenderSystem : public GraphicRenderSystem {
		public:
			ShadowPassRenderSystem(NugieVulkan::Device* device, std::vector<NugieVulkan::DescriptorSetLayout*> descriptorSetLayouts, 
				NugieVulkan::RenderPass* renderPass, const std::string& vertFilePath);

			void render(NugieVulkan::CommandBuffer* commandBuffer, const std::vector<VkDescriptorSet> &descriptorSets, 
				const std::vector<NugieVulkan::Buffer*> &vertexBuffers, NugieVulkan::Buffer* indexBuffer, 
				uint32_t indexCount, uint32_t lightIndex, const std::vector<VkDeviceSize> &vertexOffsets = {}); 

		private:
			void createPipelineLayout() override;
			void createPipeline() override;
	};
}