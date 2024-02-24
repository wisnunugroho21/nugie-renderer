#pragma once

#include <string>
#include <vector>
#include <memory>

#include "../device/device.hpp"
#include "../renderpass/renderpass.hpp"
#include "../buffer/buffer.hpp"
#include "../command/command_buffer.hpp"

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
						const std::vector<VkPipelineColorBlendAttachmentState> &colorBlendAttachments, 
						const std::vector<VkVertexInputBindingDescription> &bindingDescriptions,
						const std::vector<VkVertexInputAttributeDescription> &attributeDescriptions
					);

					Builder& setDefaultVertexGeometry(
						const std::string& vertFilePath, 
						const std::string& geomFilePath,
						const std::vector<VkVertexInputBindingDescription> &bindingDescriptions,
						const std::vector<VkVertexInputAttributeDescription> &attributeDescriptions
					);

					Builder& setDefaultVertex(
						const std::string& vertFilePath,
						const std::vector<VkVertexInputBindingDescription> &bindingDescriptions,
						const std::vector<VkVertexInputAttributeDescription> &attributeDescriptions
					);

					Builder& setSubpass(uint32_t subpass);
					Builder& setVertexInputInfo(VkPipelineVertexInputStateCreateInfo vertexInputInfo);
					Builder& setInputAssemblyInfo(VkPipelineInputAssemblyStateCreateInfo inputAssemblyInfo);
					Builder& setRasterizationInfo(VkPipelineRasterizationStateCreateInfo rasterizationInfo);
					Builder& setMultisampleInfo(VkPipelineMultisampleStateCreateInfo multisampleInfo);
					Builder& setColorBlendInfo(VkPipelineColorBlendStateCreateInfo colorBlendInfo);
					Builder& setDepthStencilInfo(VkPipelineDepthStencilStateCreateInfo depthStencilInfo);
					Builder& setDynamicStateInfo(VkPipelineDynamicStateCreateInfo dynamicStateInfo);
					Builder& setShaderStagesInfo(const std::vector<VkPipelineShaderStageCreateInfo> &shaderStagesInfo);

					GraphicPipeline* build();

				private:
					VkPipelineLayout pipelineLayout;
					VkRenderPass renderPass;
					uint32_t subpass = 0;

					VkPipelineVertexInputStateCreateInfo vertexInputInfo{};
					VkPipelineInputAssemblyStateCreateInfo inputAssemblyInfo{};
					VkPipelineRasterizationStateCreateInfo rasterizationInfo{};
					VkPipelineMultisampleStateCreateInfo multisampleInfo{};
					VkPipelineColorBlendStateCreateInfo colorBlendInfo{};
					VkPipelineDepthStencilStateCreateInfo depthStencilInfo{};
					VkPipelineDynamicStateCreateInfo dynamicStateInfo{};

					std::vector<VkDynamicState> dynamicStates{};
					std::vector<VkPipelineShaderStageCreateInfo> shaderStagesInfo{};
					
					Device* device = nullptr;
			};

			GraphicPipeline(
				Device* device, 
				VkPipelineLayout pipelineLayout,
				VkRenderPass renderPass,
				uint32_t subpass,
				VkPipelineVertexInputStateCreateInfo vertexInputInfo,
				VkPipelineInputAssemblyStateCreateInfo inputAssemblyInfo,
				VkPipelineRasterizationStateCreateInfo rasterizationInfo,
				VkPipelineMultisampleStateCreateInfo multisampleInfo,
				VkPipelineColorBlendStateCreateInfo colorBlendInfo,
				VkPipelineDepthStencilStateCreateInfo depthStencilInfo,
				VkPipelineDynamicStateCreateInfo dynamicStateInfo,
				const std::vector<VkPipelineShaderStageCreateInfo> &shaderStagesInfo
			);
			~GraphicPipeline();

			static std::vector<char> readFile(const std::string& filepath);
			static void createShaderModule(Device* device, const std::vector<char>& code, VkShaderModule* shaderModule);

			void bindPipeline(CommandBuffer* commandBuffer);
			void bindBuffers(CommandBuffer* commandBuffer, const std::vector<Buffer*> &vertexBuffers, const std::vector<VkDeviceSize>&vertexOffsets, Buffer* indexBuffer = nullptr);
			void draw(CommandBuffer* commandBuffer, uint32_t vertextCount);
			void drawIndexed(CommandBuffer* commandBuffer, uint32_t indexCount);

		private:
			Device* device = nullptr;
			VkPipeline graphicPipeline;
			std::vector<VkShaderModule> shaderModules{};

			void createGraphicPipeline(
				VkPipelineLayout pipelineLayout,
				VkRenderPass renderPass,
				uint32_t subpass,
				VkPipelineVertexInputStateCreateInfo vertexInputInfo,
				VkPipelineInputAssemblyStateCreateInfo inputAssemblyInfo,
				VkPipelineRasterizationStateCreateInfo rasterizationInfo,
				VkPipelineMultisampleStateCreateInfo multisampleInfo,
				VkPipelineColorBlendStateCreateInfo colorBlendInfo,
				VkPipelineDepthStencilStateCreateInfo depthStencilInfo,
				VkPipelineDynamicStateCreateInfo dynamicStateInfo,
				const std::vector<VkPipelineShaderStageCreateInfo> &shaderStagesInfo
			);
	};
}