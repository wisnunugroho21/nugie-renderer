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
	class ForwardPassRenderSystem : public GraphicRenderSystem {
		public:
			ForwardPassRenderSystem(NugieVulkan::Device *device, NugieVulkan::RenderPass *renderPass,
                                    std::string vertFilePath, std::string fragFilePath,
                                    const std::vector<NugieVulkan::DescriptorSetLayout *> &descriptorSetLayouts = {},
                                    const std::vector<VkPushConstantRange> &pushConstantRanges = {});

		private:
			void createPipeline() override;
	};
}