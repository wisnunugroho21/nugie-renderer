#include "raygen_pass_render_system.hpp"

#define GLM_FORCE_RADIANS
#define GLM_FORCE_DEPTH_ZERO_TO_ONE
#include <glm/glm.hpp>
#include <glm/gtc/constants.hpp>

#include <stdexcept>
#include <array>
#include <string>

namespace NugieApp {
	RayGenPassRenderSystem::RayGenPassRenderSystem(NugieVulkan::Device* device, const std::vector<NugieVulkan::DescriptorSetLayout*> &descriptorSetLayout, uint32_t width, uint32_t height, uint32_t nSample)
		: device{device}, width{width}, height{height}, nSample{nSample}
	{
		this->createPipelineLayout(descriptorSetLayout);
		this->createPipeline();
	}

	RayGenPassRenderSystem::~RayGenPassRenderSystem() {
		vkDestroyPipelineLayout(this->device->getLogicalDevice(), this->pipelineLayout, nullptr);
		if (this->pipeline != nullptr) delete this->pipeline;
	}

	void RayGenPassRenderSystem::createPipelineLayout(const std::vector<NugieVulkan::DescriptorSetLayout*> &descriptorSetLayouts) {
		std::vector<VkDescriptorSetLayout> setLayouts;
		for (auto &&descriptorSetLayout: descriptorSetLayouts) {
			setLayouts.emplace_back(descriptorSetLayout->getDescriptorSetLayout());
		}

		VkPipelineLayoutCreateInfo pipelineLayoutInfo{};
		pipelineLayoutInfo.sType = VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO;
		pipelineLayoutInfo.setLayoutCount = static_cast<uint32_t>(setLayouts.size());
		pipelineLayoutInfo.pSetLayouts = setLayouts.data();
		pipelineLayoutInfo.pushConstantRangeCount = 0u;
		pipelineLayoutInfo.pPushConstantRanges = nullptr;

		if (vkCreatePipelineLayout(this->device->getLogicalDevice(), &pipelineLayoutInfo, nullptr, &this->pipelineLayout) != VK_SUCCESS) {
			throw std::runtime_error("failed to create pipeline layout!");
		}
	}

	void RayGenPassRenderSystem::createPipeline() {
		assert(this->pipelineLayout != nullptr && "Cannot create pipeline before pipeline layout");

		this->pipeline = NugieVulkan::ComputePipeline::Builder(this->device, this->pipelineLayout)
			.setDefault("shader/raygen.comp.spv")
			.build();
	}

	void RayGenPassRenderSystem::render(NugieVulkan::CommandBuffer* commandBuffer, const std::vector<VkDescriptorSet> &descriptorSets) 
	{
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

		this->pipeline->dispatch(commandBuffer, this->width / 8, this->height / 4, this->nSample / 1);
	}
}