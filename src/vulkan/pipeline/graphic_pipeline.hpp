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
            Builder(Device *device, RenderPass *renderPass, VkPipelineLayout pipelineLayout);

            std::vector<VkDynamicState> getDynamicStates() const { return this->dynamicStates; }

            std::vector<VkPipelineShaderStageCreateInfo> getShaderStagesInfo() const { return this->shaderStagesInfo; }

            Builder &setDefault(
                    const std::string &vertFilePath,
                    const std::string &fragFilePath,
                    const std::vector<VkPipelineColorBlendAttachmentState> &colorBlendAttachments,
                    const std::vector<VkVertexInputBindingDescription> &bindingDescriptions,
                    const std::vector<VkVertexInputAttributeDescription> &attributeDescriptions
            );

            Builder &setDefault(
                    const std::vector<VkPipelineColorBlendAttachmentState> &colorBlendAttachments,
                    const std::vector<VkVertexInputBindingDescription> &bindingDescriptions,
                    const std::vector<VkVertexInputAttributeDescription> &attributeDescriptions
            );

            Builder &setDefault(
                    const std::vector<VkVertexInputBindingDescription> &bindingDescriptions,
                    const std::vector<VkVertexInputAttributeDescription> &attributeDescriptions
            );

            Builder &setSubpass(uint32_t subpass);

            Builder &setVertexInputInfo(VkPipelineVertexInputStateCreateInfo vertexInputInfo);

            Builder &setInputAssemblyInfo(VkPipelineInputAssemblyStateCreateInfo inputAssemblyInfo);

            Builder &setRasterizationInfo(VkPipelineRasterizationStateCreateInfo rasterizationInfo);

            Builder &setMultisampleInfo(VkPipelineMultisampleStateCreateInfo multisampleInfo);

            Builder &setColorBlendInfo(VkPipelineColorBlendStateCreateInfo colorBlendInfo);

            Builder &setDepthStencilInfo(VkPipelineDepthStencilStateCreateInfo depthStencilInfo);

            Builder &setDynamicStateInfo(VkPipelineDynamicStateCreateInfo dynamicStateInfo);

            Builder &setShaderStagesInfo(const std::vector<VkPipelineShaderStageCreateInfo> &shaderStagesInfo);

            Builder &setTessellationInfo(VkPipelineTessellationStateCreateInfo tessellationInfo);

            Builder &addShaderStage(VkShaderStageFlagBits shaderStage, const std::string &shaderFilePath);

            Builder &setIsMeshShader(bool isMeshShader);

            GraphicPipeline *build();

        private:
            VkPipelineLayout pipelineLayout;
            VkRenderPass renderPass;
            uint32_t subpass = 0;
            bool isMeshShader = false;

            VkPipelineVertexInputStateCreateInfo vertexInputInfo{};
            VkPipelineInputAssemblyStateCreateInfo inputAssemblyInfo{};
            VkPipelineRasterizationStateCreateInfo rasterizationInfo{};
            VkPipelineMultisampleStateCreateInfo multisampleInfo{};
            VkPipelineColorBlendStateCreateInfo colorBlendInfo{};
            VkPipelineDepthStencilStateCreateInfo depthStencilInfo{};
            VkPipelineDynamicStateCreateInfo dynamicStateInfo{};
            VkPipelineTessellationStateCreateInfo tessellationInfo{};

            std::vector<VkDynamicState> dynamicStates{};
            std::vector<VkPipelineShaderStageCreateInfo> shaderStagesInfo{};

            Device *device = nullptr;
        };

        GraphicPipeline(
                Device *device,
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
                const std::vector<VkPipelineShaderStageCreateInfo> &shaderStagesInfo,
                VkPipelineTessellationStateCreateInfo tessellationInfo,
                bool isMeshShader = false
        );

        ~GraphicPipeline();

        static std::vector<char> readFile(const std::string &filepath);

        static void createShaderModule(Device *device, const std::vector<char> &code, VkShaderModule *shaderModule);

        void bindPipeline(CommandBuffer *commandBuffer);

        static void bindBuffers(CommandBuffer *commandBuffer, const std::vector<Buffer *> &vertexBuffers,
                         const std::vector<VkDeviceSize> &vertexOffsets,
                         Buffer *indexBuffer = nullptr, VkDeviceSize indexOffset = 0);

        static void draw(CommandBuffer *commandBuffer, uint32_t vertexCount, uint32_t instanceCount);

        static void drawIndirect(CommandBuffer *commandBuffer, NugieVulkan::Buffer *drawCommandBuffer, uint32_t offset,
                                 uint32_t drawCount);

        static void drawIndexed(CommandBuffer *commandBuffer, uint32_t indexCount, uint32_t instanceCount);

        static void drawIndirectIndexed(CommandBuffer *commandBuffer, NugieVulkan::Buffer *drawCommandBuffer,
                                        uint32_t indexCount, uint32_t offset);

        static void drawMeshShader(CommandBuffer *commandBuffer, uint32_t xSize, uint32_t ySize, uint32_t zSize);

    private:
        Device *device = nullptr;
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
                const std::vector<VkPipelineShaderStageCreateInfo> &shaderStagesInfo,
                VkPipelineTessellationStateCreateInfo tessellationInfo,
                bool isMeshShader = false
        );
    };
}