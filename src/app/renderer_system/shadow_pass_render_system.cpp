#include "shadow_pass_render_system.hpp"

#define GLM_FORCE_RADIANS
#define GLM_FORCE_DEPTH_ZERO_TO_ONE
#include <glm/glm.hpp>
#include <glm/gtc/constants.hpp>

#include <stdexcept>
#include <array>
#include <string>

namespace NugieApp {
	ShadowPassRenderSystem::ShadowPassRenderSystem(NugieVulkan::Device *device, NugieVulkan::RenderPass *renderPass, 
			                   					   const std::string &vertFilePath, 
							   					   const std::vector<NugieVulkan::DescriptorSetLayout *> &descriptorSetLayouts, 
			                   					   const std::vector<VkPushConstantRange> &pushConstantRanges)
			: GraphicRenderSystem(device, renderPass, vertFilePath, "", descriptorSetLayouts, pushConstantRanges) {		
	}

	void ShadowPassRenderSystem::createPipeline() {
		assert(this->pipelineLayout != nullptr && "Cannot create pipeline before pipeline layout");

		std::vector<VkVertexInputBindingDescription> bindingDescriptions(2);
		std::vector<VkVertexInputAttributeDescription> attributeDescription(2);

		bindingDescriptions[0].binding = 0;
		bindingDescriptions[0].stride = sizeof(Vertex);
		bindingDescriptions[0].inputRate = VK_VERTEX_INPUT_RATE_VERTEX;

		bindingDescriptions[1].binding = 1;
		bindingDescriptions[1].stride = sizeof(Reference);
		bindingDescriptions[1].inputRate = VK_VERTEX_INPUT_RATE_VERTEX;

		attributeDescription[0].binding = 0;
		attributeDescription[0].location = 0;
		attributeDescription[0].format = VK_FORMAT_R32G32B32A32_SFLOAT;
		attributeDescription[0].offset = offsetof(Vertex, position);

		attributeDescription[1].binding = 1;
		attributeDescription[1].location = 1;
		attributeDescription[1].format = VK_FORMAT_R32_UINT;
		attributeDescription[1].offset = offsetof(Reference, transformIndex);

		std::vector<VkDynamicState> dynamicStates = { VK_DYNAMIC_STATE_VIEWPORT, VK_DYNAMIC_STATE_SCISSOR, VK_DYNAMIC_STATE_DEPTH_BIAS };

		auto *dynamicStateInfo = new VkPipelineDynamicStateCreateInfo();
		dynamicStateInfo->sType = VK_STRUCTURE_TYPE_PIPELINE_DYNAMIC_STATE_CREATE_INFO;
		dynamicStateInfo->dynamicStateCount = static_cast<uint32_t>(dynamicStates.size());
		dynamicStateInfo->pDynamicStates = !dynamicStates.empty() ? dynamicStates.data() : nullptr;
		dynamicStateInfo->flags = 0;

		auto *multisampleInfo = new VkPipelineMultisampleStateCreateInfo();
		multisampleInfo->sType = VK_STRUCTURE_TYPE_PIPELINE_MULTISAMPLE_STATE_CREATE_INFO;
		multisampleInfo->sampleShadingEnable = VK_FALSE;
		multisampleInfo->rasterizationSamples = VK_SAMPLE_COUNT_1_BIT;

		auto *rasterizationInfo = new VkPipelineRasterizationStateCreateInfo();
		rasterizationInfo->sType = VK_STRUCTURE_TYPE_PIPELINE_RASTERIZATION_STATE_CREATE_INFO;
		rasterizationInfo->depthClampEnable = VK_FALSE;
		rasterizationInfo->rasterizerDiscardEnable = VK_FALSE;
		rasterizationInfo->polygonMode = VK_POLYGON_MODE_FILL;
		rasterizationInfo->lineWidth = 1.0f;
		rasterizationInfo->cullMode = VK_CULL_MODE_FRONT_BIT;
		rasterizationInfo->frontFace = VK_FRONT_FACE_COUNTER_CLOCKWISE;
		rasterizationInfo->depthBiasEnable = VK_TRUE;

		this->pipeline = NugieVulkan::GraphicPipeline::Builder(this->device, this->renderPass, this->pipelineLayout)
			.setDefault(bindingDescriptions, attributeDescription)
			.addShaderStage(VK_SHADER_STAGE_VERTEX_BIT, vertFilePath)
			.setDynamicStateInfo(dynamicStateInfo)
			.setMultisampleInfo(multisampleInfo)
			.setRasterizationInfo(rasterizationInfo)
			.build();
	}

	void ShadowPassRenderSystem::render(NugieVulkan::CommandBuffer *commandBuffer, const std::vector<NugieVulkan::Buffer *> &vertexBuffers,
										NugieVulkan::Buffer *indexBuffer, uint32_t indexCount, uint32_t instanceCount,
										const std::vector<VkDeviceSize> &vertexOffsets,
										VkDeviceSize indexOffset,
										const std::vector<VkDescriptorSet> &descriptorSets,
										const std::vector<void *> &pushConstants) {

		assert((this->pipeline != nullptr) && "You must initialize this render system first!");

		vkCmdSetDepthBias(commandBuffer->getCommandBuffer(), 1.0f, 0.0f, 1.0f);

		GraphicRenderSystem::render(commandBuffer, vertexBuffers, indexBuffer, indexCount, instanceCount,
									vertexOffsets, indexOffset, descriptorSets, pushConstants);
	}
}