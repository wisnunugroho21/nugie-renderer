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
	class SkyboxPassRendererSystem : public GraphicRendererSystem {
		public:
			SkyboxPassRendererSystem(NugieVulkan::Device* device, std::vector<NugieVulkan::DescriptorSetLayout*> descriptorSetLayouts, 
				NugieVulkan::RenderPass* renderPass, const std::string& vertFilePath, const std::string& fragFilePath);

		private:
			void createPipeline() override;
	};
}