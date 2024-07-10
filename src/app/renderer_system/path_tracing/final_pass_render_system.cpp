#include "final_pass_render_system.hpp"

#define GLM_FORCE_RADIANS
#define GLM_FORCE_DEPTH_ZERO_TO_ONE
#include <glm/glm.hpp>
#include <glm/gtc/constants.hpp>

#include <stdexcept>
#include <array>
#include <string>

namespace NugieApp {
	FinalPassRenderSystem::FinalPassRenderSystem(NugieVulkan::Device *device, NugieVulkan::RenderPass *renderPass,
                            					 std::string vertFilePath, std::string fragFilePath,
                            					 const std::vector<NugieVulkan::DescriptorSetLayout *> &descriptorSetLayouts,
                            					 const std::vector<VkPushConstantRange> &pushConstantRanges)
			: GraphicRenderSystem(device, renderPass, vertFilePath, fragFilePath, descriptorSetLayouts, pushConstantRanges)
	{
		
	}

	void FinalPassRenderSystem::createPipeline() {
		assert(this->pipelineLayout != nullptr && "Cannot create pipeline before pipeline layout");

		std::vector<VkPipelineColorBlendAttachmentState> colorBlendAttachment(1);

    	colorBlendAttachment[0].colorWriteMask = VK_COLOR_COMPONENT_R_BIT | VK_COLOR_COMPONENT_G_BIT | VK_COLOR_COMPONENT_B_BIT | VK_COLOR_COMPONENT_A_BIT;
    	colorBlendAttachment[0].blendEnable = VK_FALSE;

		VkPipelineMultisampleStateCreateInfo *multisampleInfo = new VkPipelineMultisampleStateCreateInfo();
		multisampleInfo->sType = VK_STRUCTURE_TYPE_PIPELINE_MULTISAMPLE_STATE_CREATE_INFO;
		multisampleInfo->sampleShadingEnable = VK_FALSE;
		multisampleInfo->rasterizationSamples = VK_SAMPLE_COUNT_1_BIT;

		this->pipeline = NugieVulkan::GraphicPipeline::Builder(this->device, this->renderPass, this->pipelineLayout)
			.setDefault(this->vertFilePath, this->fragFilePath, colorBlendAttachment, {}, {})
			.setMultisampleInfo(multisampleInfo)
			.build();
	}
}