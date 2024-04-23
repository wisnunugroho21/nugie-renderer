#include "forward_pass_render_system.hpp"

#define GLM_FORCE_RADIANS
#define GLM_FORCE_DEPTH_ZERO_TO_ONE
#include <glm/glm.hpp>
#include <glm/gtc/constants.hpp>

#include <stdexcept>
#include <array>
#include <string>

namespace NugieApp {
	ForwardPassRenderSystem::ForwardPassRenderSystem(NugieVulkan::Device* device, std::vector<NugieVulkan::DescriptorSetLayout*> descriptorSetLayouts, 
		NugieVulkan::RenderPass* renderPass, const std::string& vertFilePath, const std::string& fragFilePath)
		: GraphicRenderSystem(device, descriptorSetLayouts, renderPass, vertFilePath, fragFilePath)
	{
		
	}

	void ForwardPassRenderSystem::createPipeline() {
		assert(this->pipelineLayout != nullptr && "Cannot create pipeline before pipeline layout");

		std::vector<VkVertexInputBindingDescription> bindingDescriptions(3);
		std::vector<VkVertexInputAttributeDescription> attributeDescription(5);
		std::vector<VkPipelineColorBlendAttachmentState> colorBlendAttachment(1);

		bindingDescriptions[0].binding = 0;
		bindingDescriptions[0].stride = sizeof(Vertex);
		bindingDescriptions[0].inputRate = VK_VERTEX_INPUT_RATE_VERTEX;

		bindingDescriptions[1].binding = 1;
		bindingDescriptions[1].stride = sizeof(NormText);
		bindingDescriptions[1].inputRate = VK_VERTEX_INPUT_RATE_VERTEX;

		bindingDescriptions[2].binding = 2;
		bindingDescriptions[2].stride = sizeof(Reference);
		bindingDescriptions[2].inputRate = VK_VERTEX_INPUT_RATE_VERTEX;

		attributeDescription[0].binding = 0;
		attributeDescription[0].location = 0;
		attributeDescription[0].format = VK_FORMAT_R32G32B32A32_SFLOAT;
		attributeDescription[0].offset = offsetof(Vertex, position);

		attributeDescription[1].binding = 1;
		attributeDescription[1].location = 1;
		attributeDescription[1].format = VK_FORMAT_R32G32B32A32_SFLOAT;
		attributeDescription[1].offset = offsetof(NormText, normal);

		attributeDescription[2].binding = 1;
		attributeDescription[2].location = 2;
		attributeDescription[2].format = VK_FORMAT_R32G32_SFLOAT;
		attributeDescription[2].offset = offsetof(NormText, textCoord);

		attributeDescription[3].binding = 2;
		attributeDescription[3].location = 3;
		attributeDescription[3].format = VK_FORMAT_R32_UINT;
		attributeDescription[3].offset = offsetof(Reference, materialIndex);

		attributeDescription[4].binding = 2;
		attributeDescription[4].location = 4;
		attributeDescription[4].format = VK_FORMAT_R32_UINT;
		attributeDescription[4].offset = offsetof(Reference, transformIndex);

    colorBlendAttachment[0].colorWriteMask = VK_COLOR_COMPONENT_R_BIT | VK_COLOR_COMPONENT_G_BIT | VK_COLOR_COMPONENT_B_BIT | VK_COLOR_COMPONENT_A_BIT;
    colorBlendAttachment[0].blendEnable = VK_FALSE;

		this->pipeline = NugieVulkan::GraphicPipeline::Builder(this->device, this->renderPass, this->pipelineLayout)
			.setDefault(this->vertFilePath, this->fragFilePath, colorBlendAttachment, bindingDescriptions, attributeDescription)
			.build();
	}
}