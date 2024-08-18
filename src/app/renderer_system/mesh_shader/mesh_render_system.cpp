#include "mesh_render_system.hpp"

#define GLM_FORCE_RADIANS
#define GLM_FORCE_DEPTH_ZERO_TO_ONE
#include <glm/glm.hpp>
#include <glm/gtc/constants.hpp>

#include <stdexcept>
#include <array>
#include <string>

namespace NugieApp {
	MeshRenderSystem::MeshRenderSystem(NugieVulkan::Device *device, NugieVulkan::RenderPass *renderPass,
                                       std::string taskFilePath, std::string meshFilePath, 
									   std::string fragFilePath,
									   NugieVulkan::DeviceProcedures *deviceProcedures,
                                       const std::vector<NugieVulkan::DescriptorSetLayout *> &descriptorSetLayouts,
                                       const std::vector<VkPushConstantRange> &pushConstantRanges)
									   : GraphicRenderSystem(device, renderPass, "", fragFilePath, descriptorSetLayouts, pushConstantRanges), 
									     taskFilePath{taskFilePath}, meshFilePath{meshFilePath}, deviceProcedures{deviceProcedures} 
	{ }

	void MeshRenderSystem::createPipeline()
	{
		assert(this->pipelineLayout != nullptr && "Cannot create pipeline before pipeline layout");

		std::vector<VkPipelineColorBlendAttachmentState> colorBlendAttachment(1);

		colorBlendAttachment[0].colorWriteMask = VK_COLOR_COMPONENT_R_BIT | VK_COLOR_COMPONENT_G_BIT | VK_COLOR_COMPONENT_B_BIT | VK_COLOR_COMPONENT_A_BIT;
		colorBlendAttachment[0].blendEnable = VK_FALSE;

		auto rasterizationInfo = new VkPipelineRasterizationStateCreateInfo();
        rasterizationInfo->sType = VK_STRUCTURE_TYPE_PIPELINE_RASTERIZATION_STATE_CREATE_INFO;
        rasterizationInfo->depthClampEnable = VK_FALSE;
        rasterizationInfo->rasterizerDiscardEnable = VK_FALSE;
        rasterizationInfo->polygonMode = VK_POLYGON_MODE_FILL;
        rasterizationInfo->lineWidth = 1.0f;
        rasterizationInfo->cullMode = VK_CULL_MODE_NONE;
        rasterizationInfo->frontFace = VK_FRONT_FACE_COUNTER_CLOCKWISE;
        rasterizationInfo->depthBiasEnable = VK_FALSE;
        rasterizationInfo->depthBiasConstantFactor = 0.0f;  // Optional
        rasterizationInfo->depthBiasClamp = 0.0f;           // Optional
        rasterizationInfo->depthBiasSlopeFactor = 0.0f;     // Optional

		this->pipeline = NugieVulkan::GraphicPipeline::Builder(this->device, this->renderPass, this->pipelineLayout, this->deviceProcedures)
			.setDefault(colorBlendAttachment)
			.setVertexInputInfo(VK_NULL_HANDLE)
			.setInputAssemblyInfo(VK_NULL_HANDLE)
			.setRasterizationInfo(rasterizationInfo)
			.addShaderStage(VK_SHADER_STAGE_TASK_BIT_EXT, this->taskFilePath)
			.addShaderStage(VK_SHADER_STAGE_MESH_BIT_EXT, this->meshFilePath)
			.addShaderStage(VK_SHADER_STAGE_FRAGMENT_BIT, this->fragFilePath)
			.build();
	}

	void MeshRenderSystem::render(NugieVulkan::CommandBuffer *commandBuffer, uint32_t xInvocations, 
                            	  uint32_t yInvocations, uint32_t zInvocations,
                            	  const std::vector<VkDescriptorSet> &descriptorSets,
                            	  const std::vector<void *> &pushConstants) 
	{
		this->pipeline->bindPipeline(commandBuffer);

		if (!descriptorSets.empty()) {
			vkCmdBindDescriptorSets(
				commandBuffer->getCommandBuffer(),
				VK_PIPELINE_BIND_POINT_GRAPHICS,
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

		this->pipeline->drawMeshShader(commandBuffer, xInvocations, yInvocations, zInvocations);
	}
}