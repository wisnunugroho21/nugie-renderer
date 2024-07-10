#pragma once

#include "../graphic_render_system.hpp"

#include <vector>

namespace NugieApp {
	class FinalPassRenderSystem : public GraphicRenderSystem {
		public:
			FinalPassRenderSystem(NugieVulkan::Device *device, NugieVulkan::RenderPass *renderPass,
                            	  std::string vertFilePath, std::string fragFilePath,
                            	  const std::vector<NugieVulkan::DescriptorSetLayout *> &descriptorSetLayouts = {},
                            	  const std::vector<VkPushConstantRange> &pushConstantRanges = {});

		private:
			void createPipeline() override;
	};
}