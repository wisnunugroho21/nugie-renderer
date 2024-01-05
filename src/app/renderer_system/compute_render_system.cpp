#include "compute_render_system.hpp"

#define GLM_FORCE_RADIANS
#define GLM_FORCE_DEPTH_ZERO_TO_ONE
#include <glm/glm.hpp>
#include <glm/gtc/constants.hpp>

#include <stdexcept>
#include <array>
#include <string>

namespace NugieApp {
	ComputeRenderSystem::ComputeRenderSystem(NugieVulkan::Device* device, const std::vector<NugieVulkan::DescriptorSetLayout*> &descriptorSetLayouts, 
		std::string compFilePath, uint32_t xThreadSize, uint32_t yThreadSize, uint32_t zThreadSize)
		: device{device}, descriptorSetLayouts{descriptorSetLayouts}, compFilePath{compFilePath}, xThreadSize{xThreadSize}, 
		yThreadSize{yThreadSize}, zThreadSize{zThreadSize}
	{
		
	}

	ComputeRenderSystem::~ComputeRenderSystem() {
		vkDestroyPipelineLayout(this->device->getLogicalDevice(), this->pipelineLayout, nullptr);
		if (this->pipeline != nullptr) delete this->pipeline;
	}

	void ComputeRenderSystem::createPipelineLayout() {
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

	void ComputeRenderSystem::createPipeline() {
		assert(this->pipelineLayout != nullptr && "Cannot create pipeline before pipeline layout");

		this->pipeline = NugieVulkan::ComputePipeline::Builder(this->device, this->pipelineLayout)
			.setDefault(this->compFilePath)
			.build();
	}

	void ComputeRenderSystem::render(NugieVulkan::CommandBuffer* commandBuffer, const std::vector<VkDescriptorSet> &descriptorSets, 
		uint32_t xInvocations, uint32_t yInvocations, uint32_t zInvocations)
	{
		assert((this->pipeline != nullptr) && "You must initialize this render system first!");
		
		this->pipeline->bindPipeline(commandBuffer);

		vkCmdBindDescriptorSets(
			commandBuffer->getCommandBuffer(),
			VK_PIPELINE_BIND_POINT_COMPUTE,
			this->pipelineLayout,
			0u,
			static_cast<uint32_t>(descriptorSets.size()),
			descriptorSets.data(),
			0u,
			nullptr
		);

		this->pipeline->dispatch(commandBuffer, xInvocations, yInvocations, zInvocations);
	}

	void ComputeRenderSystem::initialize() {
		this->createPipelineLayout();
		this->createPipeline();
	}
}