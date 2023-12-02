#include "shadow_pass_render_system.hpp"

#define GLM_FORCE_RADIANS
#define GLM_FORCE_DEPTH_ZERO_TO_ONE
#include <glm/glm.hpp>
#include <glm/gtc/constants.hpp>

#include <stdexcept>
#include <array>
#include <string>

namespace NugieApp {
	ShadowPassRenderSystem::ShadowPassRenderSystem(NugieVulkan::Device* device, NugieVulkan::DescriptorSetLayout* descriptorSetLayout, NugieVulkan::RenderPass* renderPass)
		: device{device}
	{
		this->createPipelineLayout(descriptorSetLayout);
		this->createPipeline(renderPass);
	}

	ShadowPassRenderSystem::~ShadowPassRenderSystem() {
		vkDestroyPipelineLayout(this->device->getLogicalDevice(), this->pipelineLayout, nullptr);
		if (this->pipeline != nullptr) delete this->pipeline;
	}

	void ShadowPassRenderSystem::createPipelineLayout(NugieVulkan::DescriptorSetLayout* descriptorSetLayout) {
		VkDescriptorSetLayout setLayout = descriptorSetLayout->getDescriptorSetLayout();

		VkPushConstantRange pushConstantRange{};
		pushConstantRange.stageFlags = VK_SHADER_STAGE_FRAGMENT_BIT;
		pushConstantRange.offset = 0u;
		pushConstantRange.size = sizeof(ShadowPushConstant);

		VkPipelineLayoutCreateInfo pipelineLayoutInfo{};
		pipelineLayoutInfo.sType = VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO;
		pipelineLayoutInfo.setLayoutCount = 1u;
		pipelineLayoutInfo.pSetLayouts = &setLayout;
		pipelineLayoutInfo.pushConstantRangeCount = 1u;
		pipelineLayoutInfo.pPushConstantRanges = &pushConstantRange;

		if (vkCreatePipelineLayout(this->device->getLogicalDevice(), &pipelineLayoutInfo, nullptr, &this->pipelineLayout) != VK_SUCCESS) {
			throw std::runtime_error("failed to create pipeline layout!");
		}
	}

	void ShadowPassRenderSystem::createPipeline(NugieVulkan::RenderPass* renderPass) {
		assert(this->pipelineLayout != nullptr && "Cannot create pipeline before pipeline layout");

		std::vector<VkVertexInputBindingDescription> bindingDescriptions(2);
		std::vector<VkVertexInputAttributeDescription> attributeDescription(2);

		bindingDescriptions[0].binding = 0;
		bindingDescriptions[0].stride = sizeof(Position);
		bindingDescriptions[0].inputRate = VK_VERTEX_INPUT_RATE_VERTEX;

		bindingDescriptions[1].binding = 1;
		bindingDescriptions[1].stride = sizeof(Reference);
		bindingDescriptions[1].inputRate = VK_VERTEX_INPUT_RATE_VERTEX;

		attributeDescription[0].binding = 0;
		attributeDescription[0].location = 0;
		attributeDescription[0].format = VK_FORMAT_R32G32B32A32_SFLOAT;
		attributeDescription[0].offset = 0;

		attributeDescription[1].binding = 1;
		attributeDescription[1].location = 1;
		attributeDescription[1].format = VK_FORMAT_R32_UINT;
		attributeDescription[1].offset = sizeof(uint32_t);

		VkPipelineRasterizationStateCreateInfo rasterizationInfo{};
		rasterizationInfo.sType = VK_STRUCTURE_TYPE_PIPELINE_RASTERIZATION_STATE_CREATE_INFO;
		rasterizationInfo.depthClampEnable = VK_FALSE;
		rasterizationInfo.rasterizerDiscardEnable = VK_FALSE;
		rasterizationInfo.polygonMode = VK_POLYGON_MODE_FILL;
		rasterizationInfo.lineWidth = 1.0f;
		rasterizationInfo.cullMode = VK_CULL_MODE_NONE;
		rasterizationInfo.frontFace = VK_FRONT_FACE_CLOCKWISE;
		rasterizationInfo.depthBiasEnable = VK_TRUE;

		std::vector<VkDynamicState> dynamicStates = {VK_DYNAMIC_STATE_VIEWPORT, VK_DYNAMIC_STATE_SCISSOR, VK_DYNAMIC_STATE_DEPTH_BIAS};

		VkPipelineDynamicStateCreateInfo dynamicStateInfo{};
		dynamicStateInfo.sType = VK_STRUCTURE_TYPE_PIPELINE_DYNAMIC_STATE_CREATE_INFO;
		dynamicStateInfo.dynamicStateCount = static_cast<uint32_t>(dynamicStates.size());
		dynamicStateInfo.pDynamicStates = dynamicStates.size() > 0 ? dynamicStates.data() : nullptr;
		dynamicStateInfo.flags = 0;

		this->pipeline = NugieVulkan::GraphicPipeline::Builder(this->device, renderPass, this->pipelineLayout)
			.setDefaultShadow("shader/shadow_map.vert.spv", "shader/shadow_map.geom.spv", "shader/shadow_map.frag.spv", bindingDescriptions, attributeDescription)
			.setRasterizationInfo(rasterizationInfo)
			.setDynamicStateInfo(dynamicStateInfo)
			.build();
	}

	void ShadowPassRenderSystem::render(NugieVulkan::CommandBuffer* commandBuffer, VkDescriptorSet descriptorSets, 
		std::vector<NugieVulkan::Buffer*> vertexBuffers, NugieVulkan::Buffer* indexBuffer, 
		uint32_t indexCount, std::vector<VkDeviceSize> offsets, float farPlane) 
	{
		this->pipeline->bindPipeline(commandBuffer);

		vkCmdBindDescriptorSets(
			commandBuffer->getCommandBuffer(),
			VK_PIPELINE_BIND_POINT_GRAPHICS,
			this->pipelineLayout,
			0,
			1,
			&descriptorSets,
			0,
			nullptr
		);

		if (offsets.empty()) {
			for (auto &&vertexBuffer : vertexBuffers) {
				offsets.emplace_back(0);
			}
		}

		ShadowPushConstant pushConstant{};
		pushConstant.farPlane = farPlane;

		vkCmdPushConstants(
			commandBuffer->getCommandBuffer(),
			this->pipelineLayout,
			VK_SHADER_STAGE_FRAGMENT_BIT,
			0u,
			sizeof(ShadowPushConstant),
			&pushConstant
		);

		this->pipeline->bindBuffers(commandBuffer, vertexBuffers, offsets, indexBuffer);
		this->pipeline->drawIndexed(commandBuffer, indexCount);
	}
}