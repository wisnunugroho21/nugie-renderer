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
	class ShadowPassRendererSystem : public GraphicRendererSystem {
		public:
			ShadowPassRendererSystem(NugieVulkan::Device* device, std::vector<NugieVulkan::DescriptorSetLayout*> descriptorSetLayouts, 
				NugieVulkan::RenderPass* renderPass, const std::string& vertFilePath);

			void render(NugieVulkan::CommandBuffer* commandBuffer, const std::vector<VkDescriptorSet> &descriptorSets, 
				const std::vector<NugieVulkan::Buffer*> &vertexBuffers, NugieVulkan::Buffer* indexBuffer, 
				uint32_t indexCount, uint32_t lightIndex, const std::vector<VkDeviceSize> &vertexOffsets = {}, 
				VkDeviceSize indexOffset = 0); 

		private:
			void createPipelineLayout() override;
			void createPipeline() override;
	};
}