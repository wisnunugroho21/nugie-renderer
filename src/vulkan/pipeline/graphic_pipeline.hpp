#pragma once

#include <string>
#include <vector>
#include <memory>

#include "../device/device.hpp"
#include "../renderpass/renderpass.hpp"
#include "../buffer/buffer.hpp"

namespace NugieVulkan {
	class GraphicPipeline {
		public:
			class Builder {
				public:
					Builder(Device* device, RenderPass* renderPass, VkPipelineLayout pipelineLayout);

					std::vector<VkDynamicState> getDynamicStates() const { return this->dynamicStates; }
					std::vector<VkPipelineShaderStageCreateInfo> getShaderStagesInfo() const { return this->shaderStagesInfo; }

					Builder& setDefault(
						const std::string& vertFilePath, 
						const std::string& fragFilePath,
						std::vector<VkPipelineColorBlendAttachmentState> colorBlendAttachments, 
						std::vector<VkVertexInputBindingDescription> bindingDescriptions,
						std::vector<VkVertexInputAttributeDescription> attributeDescriptions
					);

					Builder& setDefault(
						const std::string& vertFilePath,
						std::vector<VkVertexInputBindingDescription> bindingDescriptions,
						std::vector<VkVertexInputAttributeDescription> attributeDescriptions
					);

					Builder& setSubpass(uint32_t subpass);
					Builder& setInputAssemblyInfo(VkPipelineInputAssemblyStateCreateInfo inputAssemblyInfo);
					Builder& setRasterizationInfo(VkPipelineRasterizationStateCreateInfo rasterizationInfo);
					Builder& setMultisampleInfo(VkPipelineMultisampleStateCreateInfo multisampleInfo);
					Builder& setColorBlendInfo(VkPipelineColorBlendStateCreateInfo colorBlendInfo);
					Builder& setDepthStencilInfo(VkPipelineDepthStencilStateCreateInfo depthStencilInfo);
					Builder& setDynamicStateInfo(VkPipelineDynamicStateCreateInfo dynamicStateInfo);
					Builder& setShaderStagesInfo(std::vector<VkPipelineShaderStageCreateInfo> shaderStagesInfo);
					Builder& setBindingDescriptions(std::vector<VkVertexInputBindingDescription> bindingDescriptions);
					Builder& setAttributeDescriptions (std::vector<VkVertexInputAttributeDescription> attributeDescriptions);

					GraphicPipeline* build();

				private:
					VkPipelineLayout pipelineLayout = nullptr;
					VkRenderPass renderPass = nullptr;
					uint32_t subpass = 0;

					VkPipelineInputAssemblyStateCreateInfo inputAssemblyInfo{};
					VkPipelineRasterizationStateCreateInfo rasterizationInfo{};
					VkPipelineMultisampleStateCreateInfo multisampleInfo{};
					VkPipelineColorBlendStateCreateInfo colorBlendInfo{};
					VkPipelineDepthStencilStateCreateInfo depthStencilInfo{};
					VkPipelineDynamicStateCreateInfo dynamicStateInfo{};

					std::vector<VkVertexInputBindingDescription> bindingDescriptions{};
					std::vector<VkVertexInputAttributeDescription> attributeDescriptions{};
					std::vector<VkDynamicState> dynamicStates{};
					std::vector<VkPipelineColorBlendAttachmentState> colorBlendAttachments{};
					std::vector<VkPipelineShaderStageCreateInfo> shaderStagesInfo{};
					
					Device* device;
			};

			GraphicPipeline(
				Device* device, 
				VkPipelineLayout pipelineLayout,
				VkRenderPass renderPass,
				uint32_t subpass,
				std::vector<VkVertexInputBindingDescription> bindingDescriptions,
				std::vector<VkVertexInputAttributeDescription> attributeDescriptions,
				VkPipelineInputAssemblyStateCreateInfo inputAssemblyInfo,
				VkPipelineRasterizationStateCreateInfo rasterizationInfo,
				VkPipelineMultisampleStateCreateInfo multisampleInfo,
				VkPipelineColorBlendStateCreateInfo colorBlendInfo,
				VkPipelineDepthStencilStateCreateInfo depthStencilInfo,
				VkPipelineDynamicStateCreateInfo dynamicStateInfo,
				std::vector<VkPipelineShaderStageCreateInfo> shaderStagesInfo
			);
			~GraphicPipeline();

			static std::vector<char> readFile(const std::string& filepath);
			static void createShaderModule(Device* device, const std::vector<char>& code, VkShaderModule* shaderModule);

			void bindPipeline(CommandBuffer* commandBuffer);
			void bindBuffers(CommandBuffer* commandBuffer, std::vector<Buffer*> vertexBuffers, std::vector<VkDeviceSize> vertexOffsets, Buffer* indexBuffer = nullptr);
			void draw(CommandBuffer* commandBuffer, uint32_t vertextCount);
			void drawIndexed(CommandBuffer* commandBuffer, uint32_t indexCount);

		private:
			Device* device;
			VkPipeline graphicPipeline;
			std::vector<VkShaderModule> shaderModules{};

			void createGraphicPipeline(
				VkPipelineLayout pipelineLayout,
				VkRenderPass renderPass,
				uint32_t subpass,
				std::vector<VkVertexInputBindingDescription> bindingDescriptions,
				std::vector<VkVertexInputAttributeDescription> attributeDescriptions,
				VkPipelineInputAssemblyStateCreateInfo inputAssemblyInfo,
				VkPipelineRasterizationStateCreateInfo rasterizationInfo,
				VkPipelineMultisampleStateCreateInfo multisampleInfo,
				VkPipelineColorBlendStateCreateInfo colorBlendInfo,
				VkPipelineDepthStencilStateCreateInfo depthStencilInfo,
				VkPipelineDynamicStateCreateInfo dynamicStateInfo,
				std::vector<VkPipelineShaderStageCreateInfo> shaderStagesInfo
			);
	};
}