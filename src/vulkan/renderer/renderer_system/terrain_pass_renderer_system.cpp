#include "terrain_pass_renderer_system.hpp"

#define GLM_FORCE_RADIANS
#define GLM_FORCE_DEPTH_ZERO_TO_ONE
#include <glm/glm.hpp>
#include <glm/gtc/constants.hpp>

#include <stdexcept>
#include <array>
#include <string>

namespace NugieApp {
	TerrainPassRendererSystem::TerrainPassRendererSystem(NugieVulkan::Device* device, std::vector<NugieVulkan::DescriptorSetLayout*> descriptorSetLayouts, 
		NugieVulkan::RenderPass* renderPass, const std::string& vertFilePath, const std::string& tescFilePath, const std::string& teseFilePath, 
		const std::string& fragFilePath, bool isRasterLineMode) 
		: GraphicRendererSystem(device, descriptorSetLayouts, renderPass, vertFilePath, fragFilePath), tescFilePath{tescFilePath}, teseFilePath{teseFilePath}, isRasterLineMode{isRasterLineMode}
	{
		
	}

	void TerrainPassRendererSystem::createPipeline() {
		assert(this->pipelineLayout != nullptr && "Cannot create pipeline before pipeline layout");

		std::vector<VkVertexInputBindingDescription> bindingDescriptions(2);
		std::vector<VkVertexInputAttributeDescription> attributeDescription(2);
		std::vector<VkPipelineColorBlendAttachmentState> colorBlendAttachment(1);

		bindingDescriptions[0].binding = 0;
		bindingDescriptions[0].stride = sizeof(Vertex);
		bindingDescriptions[0].inputRate = VK_VERTEX_INPUT_RATE_VERTEX;

		bindingDescriptions[1].binding = 1;
		bindingDescriptions[1].stride = sizeof(NormText);
		bindingDescriptions[1].inputRate = VK_VERTEX_INPUT_RATE_VERTEX;

		attributeDescription[0].binding = 0;
		attributeDescription[0].location = 0;
		attributeDescription[0].format = VK_FORMAT_R32G32B32A32_SFLOAT;
		attributeDescription[0].offset = offsetof(Vertex, position);

		attributeDescription[1].binding = 1;
		attributeDescription[1].location = 1;
		attributeDescription[1].format = VK_FORMAT_R32G32_SFLOAT;
		attributeDescription[1].offset = offsetof(NormText, textCoord);

    colorBlendAttachment[0].colorWriteMask = VK_COLOR_COMPONENT_R_BIT | VK_COLOR_COMPONENT_G_BIT | VK_COLOR_COMPONENT_B_BIT | VK_COLOR_COMPONENT_A_BIT;
    colorBlendAttachment[0].blendEnable = VK_FALSE;

		VkPipelineInputAssemblyStateCreateInfo inputAssemblyInfo{};
		inputAssemblyInfo.sType = VK_STRUCTURE_TYPE_PIPELINE_INPUT_ASSEMBLY_STATE_CREATE_INFO;
		inputAssemblyInfo.topology = VK_PRIMITIVE_TOPOLOGY_PATCH_LIST;
		inputAssemblyInfo.primitiveRestartEnable = VK_FALSE;

		VkPipelineRasterizationStateCreateInfo rasterizationInfo{};
		rasterizationInfo.sType = VK_STRUCTURE_TYPE_PIPELINE_RASTERIZATION_STATE_CREATE_INFO;
		rasterizationInfo.depthClampEnable = VK_FALSE;
		rasterizationInfo.rasterizerDiscardEnable = VK_FALSE;
		rasterizationInfo.polygonMode = this->isRasterLineMode ? VK_POLYGON_MODE_LINE : VK_POLYGON_MODE_FILL;
		rasterizationInfo.lineWidth = 1.0f;
		rasterizationInfo.cullMode = VK_CULL_MODE_BACK_BIT;
		rasterizationInfo.frontFace = VK_FRONT_FACE_COUNTER_CLOCKWISE;
		rasterizationInfo.depthBiasEnable = VK_FALSE;

		VkPipelineTessellationStateCreateInfo tessellationInfo{};
		tessellationInfo.sType = VK_STRUCTURE_TYPE_PIPELINE_TESSELLATION_STATE_CREATE_INFO;
		tessellationInfo.patchControlPoints = 4;
		tessellationInfo.flags = 0;		

		this->pipeline = NugieVulkan::GraphicPipeline::Builder(this->device, this->renderPass, this->pipelineLayout)
			.setDefault(colorBlendAttachment, bindingDescriptions, attributeDescription)
			.addShaderStage(VK_SHADER_STAGE_VERTEX_BIT, this->vertFilePath)
			.addShaderStage(VK_SHADER_STAGE_FRAGMENT_BIT, this->fragFilePath)
			.addShaderStage(VK_SHADER_STAGE_TESSELLATION_CONTROL_BIT, this->tescFilePath)
			.addShaderStage(VK_SHADER_STAGE_TESSELLATION_EVALUATION_BIT, this->teseFilePath)
			.setInputAssemblyInfo(inputAssemblyInfo)
			.setRasterizationInfo(rasterizationInfo)
			.setTessellationInfo(tessellationInfo)
			.build();
	}

	void TerrainPassRendererSystem::render(NugieVulkan::CommandBuffer* commandBuffer, const std::vector<VkDescriptorSet> &descriptorSets, 
		const std::vector<NugieVulkan::Buffer*> &vertexBuffers, NugieVulkan::Buffer* indexBuffer, 
		NugieVulkan::Buffer* drawCommandBuffer, uint32_t indexCount, uint32_t offset)
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

		std::vector<VkDeviceSize> offsets{};
		for (auto &&vertexBuffer : vertexBuffers) {
			offsets.emplace_back(0);
		}

		this->pipeline->bindBuffers(commandBuffer, vertexBuffers, offsets, indexBuffer);		
		this->pipeline->drawIndirectIndexed(commandBuffer, drawCommandBuffer, indexCount, offset);
	}
}