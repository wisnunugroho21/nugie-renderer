#include "graphic_renderer_system.hpp"

#define GLM_FORCE_RADIANS
#define GLM_FORCE_DEPTH_ZERO_TO_ONE
#include <glm/glm.hpp>
#include <glm/gtc/constants.hpp>

#include <cassert>
#include <stdexcept>
#include <vector>

namespace NugieApp {
	GraphicRendererSystem::GraphicRendererSystem(NugieVulkan::Device* device, std::vector<NugieVulkan::DescriptorSetLayout*> descriptorSetLayouts, 
		NugieVulkan::RenderPass* renderPass, const std::string& vertFilePath, const std::string& fragFilePath)
		: device{device}, descriptorSetLayouts{descriptorSetLayouts}, renderPass{renderPass}, vertFilePath{vertFilePath}, 
			fragFilePath{fragFilePath}
	{
		
	}

	GraphicRendererSystem::~GraphicRendererSystem() {
		vkDestroyPipelineLayout(this->device->getLogicalDevice(), this->pipelineLayout, nullptr);
		if (this->pipeline != nullptr) delete this->pipeline;
	}

	void GraphicRendererSystem::createPipelineLayout() {
		std::vector<VkDescriptorSetLayout> setLayouts;
		for (auto &&descriptorSetLayout: this->descriptorSetLayouts) {
			setLayouts.emplace_back(descriptorSetLayout->getDescriptorSetLayout());
		}

		VkPipelineLayoutCreateInfo pipelineLayoutInfo{};
		pipelineLayoutInfo.sType = VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO;
		pipelineLayoutInfo.setLayoutCount = static_cast<uint32_t>(setLayouts.size());
		pipelineLayoutInfo.pSetLayouts = (setLayouts.size() > 0) ? setLayouts.data() : nullptr;
		pipelineLayoutInfo.pushConstantRangeCount = 0u;
		pipelineLayoutInfo.pPushConstantRanges = nullptr;

		if (vkCreatePipelineLayout(this->device->getLogicalDevice(), &pipelineLayoutInfo, nullptr, &this->pipelineLayout) != VK_SUCCESS) {
			throw std::runtime_error("failed to create pipeline layout!");
		}
	}

	void GraphicRendererSystem::createPipeline() {
		assert(this->pipelineLayout != nullptr && "Cannot create pipeline before pipeline layout");

		std::vector<VkVertexInputBindingDescription> bindingDescriptions(1);
		std::vector<VkVertexInputAttributeDescription> attributeDescription(1);
		std::vector<VkPipelineColorBlendAttachmentState> colorBlendAttachment(1);

		bindingDescriptions[0].binding = 0;
		bindingDescriptions[0].stride = sizeof(glm::vec4);
		bindingDescriptions[0].inputRate = VK_VERTEX_INPUT_RATE_VERTEX;

		attributeDescription[0].binding = 0;
		attributeDescription[0].location = 0;
		attributeDescription[0].format = VK_FORMAT_R32G32B32A32_SFLOAT;
		attributeDescription[0].offset = 0;

    colorBlendAttachment[0].colorWriteMask = VK_COLOR_COMPONENT_R_BIT | VK_COLOR_COMPONENT_G_BIT | VK_COLOR_COMPONENT_B_BIT | VK_COLOR_COMPONENT_A_BIT;
    colorBlendAttachment[0].blendEnable = VK_FALSE;

		this->pipeline = NugieVulkan::GraphicPipeline::Builder(this->device, this->renderPass, this->pipelineLayout)
			.setDefault(this->vertFilePath, this->fragFilePath, colorBlendAttachment, bindingDescriptions, attributeDescription)
			.build();
	}

	void GraphicRendererSystem::render(NugieVulkan::CommandBuffer* commandBuffer, const std::vector<VkDescriptorSet> &descriptorSets, 
		const std::vector<NugieVulkan::Buffer*> &vertexBuffers, NugieVulkan::Buffer* indexBuffer, uint32_t indexCount, 
		const std::vector<VkDeviceSize> &vertexOffsets, VkDeviceSize indexOffset) 
	{
		assert((this->pipeline != nullptr) && "You must initialize this render system first!");

		this->pipeline->bindPipeline(commandBuffer);

		vkCmdBindDescriptorSets(
			commandBuffer->getCommandBuffer(),
			VK_PIPELINE_BIND_POINT_GRAPHICS,
			this->pipelineLayout,
			0,
			static_cast<uint32_t>(descriptorSets.size()),
			(descriptorSets.size() > 0) ? descriptorSets.data() : nullptr,
			0,
			nullptr
		);

		if (vertexOffsets.size() == 0) {
			std::vector<VkDeviceSize> offsets{};
			for (auto &&vertexBuffer : vertexBuffers) {
				offsets.emplace_back(0);
			}

			this->pipeline->bindBuffers(commandBuffer, vertexBuffers, offsets, indexBuffer, indexOffset);
		} else {
			this->pipeline->bindBuffers(commandBuffer, vertexBuffers, vertexOffsets, indexBuffer, indexOffset);
		}
		
		this->pipeline->drawIndexed(commandBuffer, indexCount, 1);
	}

	void GraphicRendererSystem::initialize() {
		this->createPipelineLayout();
		this->createPipeline();
	}
}