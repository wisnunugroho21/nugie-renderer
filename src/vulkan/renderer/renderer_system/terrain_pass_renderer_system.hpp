#pragma once

#include "graphic_renderer_system.hpp"

#include "../../object/command/command_buffer.hpp"
#include "../../object/device/device.hpp"
#include "../../object/pipeline/graphic_pipeline.hpp"
#include "../../object/buffer/buffer.hpp"
#include "../../object/descriptor/descriptor_set_layout.hpp"
#include "../../object/swap_chain/swap_chain.hpp"
#include "../../object/renderpass/renderpass.hpp"

#include "../general_struct.hpp"

#include <vector>

namespace NugieApp {
	class TerrainPassRendererSystem : public GraphicRendererSystem {
		public:
			TerrainPassRendererSystem(NugieVulkan::Device* device, std::vector<NugieVulkan::DescriptorSetLayout*> descriptorSetLayouts, 
				NugieVulkan::RenderPass* renderPass, const std::string& vertFilePath, const std::string& tescFilePath, 
				const std::string& teseFilePath, const std::string& fragFilePath, bool isRasterLineMode = false);

			using GraphicRendererSystem::render;
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