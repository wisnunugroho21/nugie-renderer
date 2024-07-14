#pragma once

#include "../../vulkan/command/command_buffer.hpp"
#include "../../vulkan/device/device.hpp"
#include "../../vulkan/pipeline/compute_pipeline.hpp"
#include "../../vulkan/buffer/buffer.hpp"
#include "../../vulkan/descriptor/descriptor_set_layout.hpp"

#include <vector>

namespace NugieApp {
    class ComputeRenderSystem {
    public:
        ComputeRenderSystem(NugieVulkan::Device *device, std::string compFilePath,
                            const std::vector<NugieVulkan::DescriptorSetLayout *> &descriptorSetLayouts,
                            const std::vector<VkPushConstantRange> &pushConstantRanges = {});

        ~ComputeRenderSystem();

        void initialize();

        virtual void render(NugieVulkan::CommandBuffer *commandBuffer, uint32_t xInvocations, 
                            uint32_t yInvocations, uint32_t zInvocations,
                            const std::vector<VkDescriptorSet> &descriptorSets = {},
                            const std::vector<void *> &pushConstants = {});

    private:
        virtual void createPipelineLayout();

        virtual void createPipeline();

        NugieVulkan::Device *device = nullptr;

        VkPipelineLayout pipelineLayout;
        NugieVulkan::ComputePipeline *pipeline = nullptr;

        std::vector<NugieVulkan::DescriptorSetLayout *> descriptorSetLayouts;
        std::vector<VkPushConstantRange> pushConstantRanges;

        std::string compFilePath;
    };
}