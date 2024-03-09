#include "terrain_pass_render_system.hpp"

#define GLM_FORCE_RADIANS
#define GLM_FORCE_DEPTH_ZERO_TO_ONE
#include <glm/glm.hpp>
#include <glm/gtc/constants.hpp>

#include <stdexcept>
#include <array>
#include <string>

namespace NugieApp {
	TerrainPassRenderSystem::TerrainPassRenderSystem(NugieVulkan::Device* device, std::vector<NugieVulkan::DescriptorSetLayout*> descriptorSetLayouts, 
		NugieVulkan::RenderPass* renderPass, const std::string& vertFilePath, const std::string& tescFilePath, const std::string& teseFilePath, 
		const std::string& fragFilePath, bool isRasterLineMode) 
		: GraphicRenderSystem(device, descriptorSetLayouts, renderPass, vertFilePath, fragFilePath), tescFilePath{tescFilePath}, teseFilePath{teseFilePath}, isRasterLineMode{isRasterLineMode}
	{
		
	}

	void TerrainPassRenderSystem::createPipeline() {
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

		this->pipeline = NugieVulkan::GraphicPipeline::Builder(this->device, this->renderPass, this->pipelineLayout)
			.setDefaultTessallation(this->vertFilePath, this->tescFilePath, this->teseFilePath, this->fragFilePath, 
				colorBlendAttachment, bindingDescriptions, attributeDescription)
			.setInputAssemblyInfo(inputAssemblyInfo)
			.setRasterizationInfo(rasterizationInfo)
			.buildTessallation();
	}
}