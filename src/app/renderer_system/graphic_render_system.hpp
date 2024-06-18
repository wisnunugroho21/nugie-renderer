#pragma once

#include "../../vulkan/command/command_buffer.hpp"
#include "../../vulkan/device/device.hpp"
#include "../../vulkan/pipeline/graphic_pipeline.hpp"
#include "../../vulkan/buffer/buffer.hpp"
#include "../../vulkan/descriptor/descriptor_set_layout.hpp"
#include "../../vulkan/swap_chain/swap_chain.hpp"
#include "../../vulkan/renderpass/renderpass.hpp"

#include "../general_struct.hpp"

#include <vector>
#include <string>

namespace NugieApp {
    class GraphicRenderSystem {
    public:
        GraphicRenderSystem(NugieVulkan::Device *device, NugieVulkan::RenderPass *renderPass,
                            std::string vertFilePath, std::string fragFilePath,
                            const std::vector<NugieVulkan::DescriptorSetLayout *> &descriptorSetLayouts = {},
                            const std::vector<VkPushConstantRange> &pushConstantRanges = {});

        ~GraphicRenderSystem();

        void initialize();

        virtual void
        render(NugieVulkan::CommandBuffer *commandBuffer, const std::vector<NugieVulkan::Buffer *> &vertexBuffers,
               NugieVulkan::Buffer *indexBuffer, uint32_t indexCount, uint32_t instanceCount = 1u,
               const std::vector<VkDeviceSize> &vertexOffsets = {}, 
               VkDeviceSize indexOffset = 0u,
               const std::vector<VkDescriptorSet> &descriptorSets = {},
               const std::vector<void *> &pushConstants = {});

        virtual void
        render(NugieVulkan::CommandBuffer *commandBuffer, const std::vector<NugieVulkan::Buffer *> &vertexBuffers,
               uint32_t vertexCount, uint32_t instanceCount = 1u, 
               const std::vector<VkDeviceSize> &vertexOffsets = {}, 
               const std::vector<VkDescriptorSet> &descriptorSets = {},
               const std::vector<void *> &pushConstants = {});

    protected:
        virtual void createPipelineLayout();

        virtual void createPipeline();

        NugieVulkan::Device *device = nullptr;

        VkPipelineLayout pipelineLayout;
        NugieVulkan::GraphicPipeline *pipeline = nullptr;

        std::vector<NugieVulkan::DescriptorSetLayout *> descriptorSetLayouts;
        std::vector<VkPushConstantRange> pushConstantRanges;

        NugieVulkan::RenderPass *renderPass = nullptr;
        std::string vertFilePath, fragFilePath;
    };
}