#pragma once

#include "quad_graphic_render_system.hpp"

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
	class DeferredPassRenderSystem : public QuadGraphicRenderSystem {
		public:
			DeferredPassRenderSystem(NugieVulkan::Device* device, std::vector<NugieVulkan::DescriptorSetLayout*> descriptorSetLayouts, 
				NugieVulkan::RenderPass* renderPass, const std::string &fragFilePath);
		
		private:
			void createPipeline() override;
	};
}