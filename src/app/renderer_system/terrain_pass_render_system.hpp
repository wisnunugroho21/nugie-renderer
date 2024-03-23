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
	class TerrainPassRenderSystem : public GraphicRenderSystem {
		public:
			TerrainPassRenderSystem(NugieVulkan::Device* device, std::vector<NugieVulkan::DescriptorSetLayout*> descriptorSetLayouts, 
				NugieVulkan::RenderPass* renderPass, const std::string& vertFilePath, const std::string& tescFilePath, 
				const std::string& teseFilePath, const std::string& fragFilePath, bool isRasterLineMode = false);

			using GraphicRenderSystem::render;
			void render(NugieVulkan::CommandBuffer* commandBuffer, const std::vector<VkDescriptorSet> &descriptorSets, 
				const std::vector<NugieVulkan::Buffer*> &vertexBuffers, NugieVulkan::Buffer* indexBuffer, 
				NugieVulkan::Buffer* drawCommandBuffer, uint32_t indexCount, uint32_t offset);

		private:
			void createPipeline() override;

			std::string tescFilePath;
			std::string teseFilePath;
			bool isRasterLineMode = false;
	};
}