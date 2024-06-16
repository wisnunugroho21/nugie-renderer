#include "compute_render_system.hpp"

#define GLM_FORCE_RADIANS
#define GLM_FORCE_DEPTH_ZERO_TO_ONE
#include <glm/glm.hpp>
#include <glm/gtc/constants.hpp>

#include <stdexcept>
#include <array>
#include <string>
#include <utility>

namespace NugieApp {
	ComputeRenderSystem::ComputeRenderSystem(NugieVulkan::Device* device, std::string compFilePath, const std::vector<NugieVulkan::DescriptorSetLayout*> &descriptorSetLayouts, 
		const std::vector<VkPushConstantRange> &pushConstantRanges)
		: device{device}, compFilePath{std::move(compFilePath)}, descriptorSetLayouts{descriptorSetLayouts}, pushConstantRanges{pushConstantRanges}
	{
		
	}

	ComputeRenderSystem::~ComputeRenderSystem() {
		vkDestroyPipelineLayout(this->device->getLogicalDevice(), this->pipelineLayout, nullptr);
		delete this->pipeline;
	}

	void ComputeRenderSystem::createPipelineLayout() {
		std::vector<VkDescriptorSetLayout> setLayouts;
		setLayouts.reserve(this->descriptorSetLayouts.size());

        for (auto &&descriptorSetLayout: this->descriptorSetLayouts) {
			setLayouts.emplace_back(descriptorSetLayout->getDescriptorSetLayout());
		}

		VkPipelineLayoutCreateInfo pipelineLayoutInfo{};
		pipelineLayoutInfo.sType = VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO;
		pipelineLayoutInfo.setLayoutCount = static_cast<uint32_t>(setLayouts.size());
		pipelineLayoutInfo.pSetLayouts = (!setLayouts.empty()) ? setLayouts.data() : nullptr;
		pipelineLayoutInfo.pushConstantRangeCount = static_cast<uint32_t>(pushConstantRanges.size());
		pipelineLayoutInfo.pPushConstantRanges = (!pushConstantRanges.empty()) ? pushConstantRanges.data() : nullptr;

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

	void ComputeRenderSystem::render(NugieVulkan::CommandBuffer* commandBuffer, uint32_t xInvocations, uint32_t yInvocations, 
		uint32_t zInvocations, const std::vector<VkDescriptorSet> &descriptorSets, const std::vector<void *> &pushConstants)
	{
		assert((this->pipeline != nullptr) && "You must initialize this render system first!");
		
		this->pipeline->bindPipeline(commandBuffer);

		if (!descriptorSets.empty()) {
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
		}

		if (!pushConstants.empty()) {
			for (size_t i = 0; i < pushConstants.size(); i++) {
				vkCmdPushConstants(
					commandBuffer->getCommandBuffer(),
					this->pipelineLayout,
					this->pushConstantRanges[i].stageFlags,
					this->pushConstantRanges[i].offset,
					this->pushConstantRanges[i].size,
					pushConstants[i]
				);
			}
		}

		NugieVulkan::ComputePipeline::dispatch(commandBuffer, xInvocations, yInvocations, zInvocations);
	}

	void ComputeRenderSystem::initialize() {
		this->createPipelineLayout();
		this->createPipeline();
	}
}