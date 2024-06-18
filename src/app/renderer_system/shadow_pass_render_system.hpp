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
		ShadowPassRenderSystem(NugieVulkan::Device *device, NugieVulkan::RenderPass *renderPass, 
			                   const std::string &vertFilePath, 
							   const std::vector<NugieVulkan::DescriptorSetLayout *> &descriptorSetLayouts = {}, 
			                   const std::vector<VkPushConstantRange> &pushConstantRanges = {});

		void
		render(NugieVulkan::CommandBuffer *commandBuffer, const std::vector<NugieVulkan::Buffer *> &vertexBuffers,
			   NugieVulkan::Buffer *indexBuffer, uint32_t indexCount, uint32_t instanceCount = 1u,
			   const std::vector<VkDeviceSize> &vertexOffsets = {},
			   VkDeviceSize indexOffset = 0u,
			   const std::vector<VkDescriptorSet> &descriptorSets = {},
			   const std::vector<void *> &pushConstants = {})
		override;

	private:
		void createPipeline() override;
	};
}