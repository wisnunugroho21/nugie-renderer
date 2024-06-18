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
				taskFilePath{taskFilePath}, meshFilePath{meshFilePath}, deviceProcedures{deviceProcedures} {
	}

	void MeshRenderSystem::createPipeline()
	{
		assert(this->pipelineLayout != nullptr && "Cannot create pipeline before pipeline layout");

		std::vector<VkPipelineColorBlendAttachmentState> colorBlendAttachment(1);

		colorBlendAttachment[0].colorWriteMask = VK_COLOR_COMPONENT_R_BIT | VK_COLOR_COMPONENT_G_BIT | VK_COLOR_COMPONENT_B_BIT | VK_COLOR_COMPONENT_A_BIT;
		colorBlendAttachment[0].blendEnable = VK_FALSE;

		this->pipeline = NugieVulkan::GraphicPipeline::Builder(this->device, this->renderPass, this->pipelineLayout, this->deviceProcedures)
			.setDefault(colorBlendAttachment)
			.setVertexInputInfo(VK_NULL_HANDLE)
			.setInputAssemblyInfo(VK_NULL_HANDLE)
			.addShaderStage(VK_SHADER_STAGE_TASK_BIT_EXT, this->taskFilePath)
			.addShaderStage(VK_SHADER_STAGE_MESH_BIT_EXT, this->meshFilePath)
			.addShaderStage(VK_SHADER_STAGE_FRAGMENT_BIT, this->fragFilePath)
			.build();
	}

	void MeshRenderSystem::render(NugieVulkan::CommandBuffer *commandBuffer) {
		this->pipeline->bindPipeline(commandBuffer);
		this->pipeline->drawMeshShader(commandBuffer, 1, 1, 1);
	}
}