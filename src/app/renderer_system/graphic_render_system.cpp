#include "graphic_render_system.hpp"

#define GLM_FORCE_RADIANS
#define GLM_FORCE_DEPTH_ZERO_TO_ONE

#include <glm/glm.hpp>
#include <glm/gtc/constants.hpp>

#include <cassert>
#include <stdexcept>
#include <utility>
#include <vector>

namespace NugieApp {
    GraphicRenderSystem::GraphicRenderSystem(NugieVulkan::Device *device, NugieVulkan::RenderPass *renderPass,
                                            std::string vertFilePath, std::string fragFilePath,
                                            const std::vector<NugieVulkan::DescriptorSetLayout *> &descriptorSetLayouts,
                                            const std::vector<VkPushConstantRange> &pushConstantRanges)
            : device{device}, descriptorSetLayouts{std::move(descriptorSetLayouts)}, pushConstantRanges{std::move(pushConstantRanges)}, renderPass{renderPass},
              vertFilePath{std::move(vertFilePath)}, fragFilePath{std::move(fragFilePath)} 
    {

    }

    GraphicRenderSystem::~GraphicRenderSystem() {
        vkDestroyPipelineLayout(this->device->getLogicalDevice(), this->pipelineLayout, nullptr);
        delete this->pipeline;
    }

    void GraphicRenderSystem::createPipelineLayout() {
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

        if (vkCreatePipelineLayout(this->device->getLogicalDevice(), &pipelineLayoutInfo, nullptr,
                                   &this->pipelineLayout) != VK_SUCCESS) {
            throw std::runtime_error("failed to create pipeline layout!");
        }
    }

    void GraphicRenderSystem::createPipeline() {
        assert(this->pipelineLayout != nullptr && "Cannot create pipeline before pipeline layout");

        std::vector<VkVertexInputBindingDescription> bindingDescriptions(1);
        std::vector<VkVertexInputAttributeDescription> attributeDescription(1);
        std::vector<VkPipelineColorBlendAttachmentState> colorBlendAttachment(1);

        bindingDescriptions[0].binding = 0;
        bindingDescriptions[0].stride = sizeof(glm::vec4);
        bindingDescriptions[0].inputRate = VK_VERTEX_INPUT_RATE_VERTEX;

        attributeDescription[0].binding = 0;
        attributeDescription[0].location = 0;
        attributeDescription[0].format = VK_FORMAT_R32G32B32A32_SFLOAT;
        attributeDescription[0].offset = 0;

        colorBlendAttachment[0].colorWriteMask =
                VK_COLOR_COMPONENT_R_BIT | VK_COLOR_COMPONENT_G_BIT | VK_COLOR_COMPONENT_B_BIT |
                VK_COLOR_COMPONENT_A_BIT;
        colorBlendAttachment[0].blendEnable = VK_FALSE;

        this->pipeline = NugieVulkan::GraphicPipeline::Builder(this->device, this->renderPass, this->pipelineLayout)
            .setDefault(this->vertFilePath, this->fragFilePath, colorBlendAttachment, bindingDescriptions,
                        attributeDescription)
            .build();
    }

    void GraphicRenderSystem::render(NugieVulkan::CommandBuffer *commandBuffer, uint32_t vertexCount,
                                     uint32_t instanceCount,
                                     const std::vector<VkDescriptorSet> &descriptorSets,
                                     const std::vector<void *> &pushConstants) 
    {
        assert((this->pipeline != nullptr) && "You must initialize this render system first!");

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
        
        NugieVulkan::GraphicPipeline::draw(commandBuffer, vertexCount, instanceCount);
    }

    void GraphicRenderSystem::render(NugieVulkan::CommandBuffer *commandBuffer, 
                                     const std::vector<NugieVulkan::Buffer *> &vertexBuffers,
                                     NugieVulkan::Buffer *indexBuffer, uint32_t indexCount, 
                                     uint32_t instanceCount,
                                     const std::vector<VkDeviceSize> &vertexOffsets, 
                                     VkDeviceSize indexOffset,
                                     const std::vector<VkDescriptorSet> &descriptorSets,
                                     const std::vector<void *> &pushConstants) {
        assert((this->pipeline != nullptr) && "You must initialize this render system first!");

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

        if (vertexOffsets.empty()) {
            std::vector<VkDeviceSize> offsets{};
            offsets.reserve(vertexBuffers.size());

            for (auto &&vertexBuffer: vertexBuffers) {
                offsets.emplace_back(0);
            }

            NugieVulkan::GraphicPipeline::bindBuffers(commandBuffer, vertexBuffers, offsets, indexBuffer, indexOffset);
        } else {
            NugieVulkan::GraphicPipeline::bindBuffers(commandBuffer, vertexBuffers, vertexOffsets, indexBuffer, indexOffset);
        }

        NugieVulkan::GraphicPipeline::drawIndexed(commandBuffer, indexCount, instanceCount);
    }

    void GraphicRenderSystem::render(NugieVulkan::CommandBuffer *commandBuffer, const std::vector<NugieVulkan::Buffer *> &vertexBuffers,
                                     uint32_t vertexCount, uint32_t instanceCount, 
                                     const std::vector<VkDeviceSize> &vertexOffsets, 
                                     const std::vector<VkDescriptorSet> &descriptorSets,
                                     const std::vector<void *> &pushConstants) {
        assert((this->pipeline != nullptr) && "You must initialize this render system first!");

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

        if (vertexOffsets.empty()) {
            std::vector<VkDeviceSize> offsets{};
            offsets.reserve(vertexBuffers.size());

            for (auto &&vertexBuffer: vertexBuffers) {
                offsets.emplace_back(0);
            }

            NugieVulkan::GraphicPipeline::bindBuffers(commandBuffer, vertexBuffers, offsets);
        } else {
            NugieVulkan::GraphicPipeline::bindBuffers(commandBuffer, vertexBuffers, vertexOffsets);
        }

        NugieVulkan::GraphicPipeline::draw(commandBuffer, vertexCount, instanceCount);
    }

    void GraphicRenderSystem::initialize() {
        this->createPipelineLayout();
        this->createPipeline();
    }
}