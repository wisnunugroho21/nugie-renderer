#include "forward_pass_render_system.hpp"

#define GLM_FORCE_RADIANS
#define GLM_FORCE_DEPTH_ZERO_TO_ONE
#include <glm/glm.hpp>
#include <glm/gtc/constants.hpp>

#include <stdexcept>
#include <array>
#include <string>

namespace NugieApp {
	ForwardPassRenderSystem::ForwardPassRenderSystem(NugieVulkan::Device* device, NugieVulkan::DescriptorSetLayout* descriptorSetLayout, NugieVulkan::RenderPass* renderPass)
		: device{device}
	{
		this->createPipelineLayout(descriptorSetLayout);
		this->createPipeline(renderPass);
	}

	ForwardPassRenderSystem::~ForwardPassRenderSystem() {
		vkDestroyPipelineLayout(this->device->getLogicalDevice(), this->pipelineLayout, nullptr);
		if (this->pipeline != nullptr) delete this->pipeline;
	}

	void ForwardPassRenderSystem::createPipelineLayout(NugieVulkan::DescriptorSetLayout* descriptorSetLayout) {
		VkDescriptorSetLayout setLayout = descriptorSetLayout->getDescriptorSetLayout();

		VkPipelineLayoutCreateInfo pipelineLayoutInfo{};
		pipelineLayoutInfo.sType = VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO;
		pipelineLayoutInfo.setLayoutCount = 1u;
		pipelineLayoutInfo.pSetLayouts = &setLayout;
		pipelineLayoutInfo.pushConstantRangeCount = 0u;
		pipelineLayoutInfo.pPushConstantRanges = nullptr;

		if (vkCreatePipelineLayout(this->device->getLogicalDevice(), &pipelineLayoutInfo, nullptr, &this->pipelineLayout) != VK_SUCCESS) {
			throw std::runtime_error("failed to create pipeline layout!");
		}
	}

	void ForwardPassRenderSystem::createPipeline(NugieVulkan::RenderPass* renderPass) {
		assert(this->pipelineLayout != nullptr && "Cannot create pipeline before pipeline layout");

		std::vector<VkVertexInputBindingDescription> bindingDescriptions(3);
		std::vector<VkVertexInputAttributeDescription> attributeDescription(4);
		std::vector<VkPipelineColorBlendAttachmentState> colorBlendAttachment(4);

		bindingDescriptions[0].binding = 0;
		bindingDescriptions[0].stride = sizeof(glm::vec4);
		bindingDescriptions[0].inputRate = VK_VERTEX_INPUT_RATE_VERTEX;

		bindingDescriptions[1].binding = 1;
		bindingDescriptions[1].stride = sizeof(glm::vec4);
		bindingDescriptions[1].inputRate = VK_VERTEX_INPUT_RATE_VERTEX;

		bindingDescriptions[2].binding = 2;
		bindingDescriptions[2].stride = sizeof(glm::uvec2);
		bindingDescriptions[2].inputRate = VK_VERTEX_INPUT_RATE_VERTEX;

		attributeDescription[0].binding = 0;
		attributeDescription[0].location = 0;
		attributeDescription[0].format = VK_FORMAT_R32G32B32A32_SFLOAT;
		attributeDescription[0].offset = 0;

		attributeDescription[1].binding = 1;
		attributeDescription[1].location = 1;
		attributeDescription[1].format = VK_FORMAT_R32G32B32A32_SFLOAT;
		attributeDescription[1].offset = 0;

		attributeDescription[2].binding = 2;
		attributeDescription[2].location = 2;
		attributeDescription[2].format = VK_FORMAT_R32_UINT;
		attributeDescription[2].offset = 0;

		attributeDescription[3].binding = 2;
		attributeDescription[3].location = 3;
		attributeDescription[3].format = VK_FORMAT_R32_UINT;
		attributeDescription[3].offset = sizeof(uint32_t);

    colorBlendAttachment[0].colorWriteMask = VK_COLOR_COMPONENT_R_BIT | VK_COLOR_COMPONENT_G_BIT | VK_COLOR_COMPONENT_B_BIT | VK_COLOR_COMPONENT_A_BIT;
    colorBlendAttachment[0].blendEnable = VK_FALSE;

		colorBlendAttachment[1].colorWriteMask = VK_COLOR_COMPONENT_R_BIT | VK_COLOR_COMPONENT_G_BIT | VK_COLOR_COMPONENT_B_BIT | VK_COLOR_COMPONENT_A_BIT;
    colorBlendAttachment[1].blendEnable = VK_FALSE;

		colorBlendAttachment[2].colorWriteMask = VK_COLOR_COMPONENT_R_BIT | VK_COLOR_COMPONENT_G_BIT | VK_COLOR_COMPONENT_B_BIT | VK_COLOR_COMPONENT_A_BIT;
    colorBlendAttachment[2].blendEnable = VK_FALSE;

		colorBlendAttachment[3].colorWriteMask = VK_COLOR_COMPONENT_R_BIT | VK_COLOR_COMPONENT_G_BIT | VK_COLOR_COMPONENT_B_BIT | VK_COLOR_COMPONENT_A_BIT;
    colorBlendAttachment[4].blendEnable = VK_FALSE;

		this->pipeline = NugieVulkan::GraphicPipeline::Builder(this->device, renderPass, this->pipelineLayout)
			.setDefault("shader/forward.vert.spv", "shader/forward.frag.spv", colorBlendAttachment, bindingDescriptions, attributeDescription)
			.setSubpass(0u)
			.build();
	}

	void ForwardPassRenderSystem::render(NugieVulkan::CommandBuffer* commandBuffer, VkDescriptorSet descriptorSets, 
		std::vector<NugieVulkan::Buffer*> vertexBuffers, NugieVulkan::Buffer* indexBuffer, 
		uint32_t indexCount, std::vector<VkDeviceSize> offsets) 
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

		this->pipeline->bindBuffers(commandBuffer, vertexBuffers, offsets, indexBuffer);
		this->pipeline->drawIndexed(commandBuffer, indexCount);
	}
}