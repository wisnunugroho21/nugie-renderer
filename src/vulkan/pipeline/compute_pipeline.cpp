#include "compute_pipeline.hpp"

#include <fstream>
#include <iostream>
#include <stdexcept>

namespace NugieVulkan {
    ComputePipeline::Builder::Builder(Device *device, VkPipelineLayout pipelineLayout) : device{device} {
        this->pipelineLayout = pipelineLayout;
    }

    ComputePipeline::Builder &ComputePipeline::Builder::setDefault(const std::string &compFilePath) {
        VkShaderModule compShaderModule;

        auto compCode = ComputePipeline::readFile(compFilePath);

        ComputePipeline::createShaderModule(this->device, compCode, &compShaderModule);

        VkPipelineShaderStageCreateInfo computeShaderStageInfo{};
        computeShaderStageInfo.sType = VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO;
        computeShaderStageInfo.stage = VK_SHADER_STAGE_COMPUTE_BIT;
        computeShaderStageInfo.module = compShaderModule;
        computeShaderStageInfo.pName = "main";
        computeShaderStageInfo.flags = 0;
        computeShaderStageInfo.pNext = nullptr;
        computeShaderStageInfo.pSpecializationInfo = nullptr;

        this->shaderStageInfo = computeShaderStageInfo;
        return *this;
    }

    ComputePipeline::Builder &ComputePipeline::Builder::setShaderStageInfo(
            VkPipelineShaderStageCreateInfo shaderStageInfo) 
    {
        this->shaderStageInfo = shaderStageInfo;
        return *this;
    }

    ComputePipeline::Builder &ComputePipeline::Builder::setBasePipelineHandleInfo(VkPipeline basePipeline) {
        this->basePipelineHandleInfo = basePipeline;
        return *this;
    }

    ComputePipeline::Builder &ComputePipeline::Builder::setBasePipelineIndex(int32_t basePipelineIndex) {
        this->basePipelineIndex = basePipelineIndex;
        return *this;
    }

    ComputePipeline *ComputePipeline::Builder::build() {
        return new ComputePipeline(
                this->device,
                this->pipelineLayout,
                this->shaderStageInfo,
                this->basePipelineHandleInfo,
                this->basePipelineIndex
        );
    }

    ComputePipeline::ComputePipeline(Device *device, VkPipelineLayout pipelineLayout,
                                     VkPipelineShaderStageCreateInfo shaderStageInfo, VkPipeline basePipelineHandleInfo,
                                     int32_t basePipelineIndex) 
                                     : device{device} 
    {
        this->createGraphicPipeline(
                pipelineLayout,
                shaderStageInfo,
                basePipelineHandleInfo,
                basePipelineIndex
        );
    }

    ComputePipeline::~ComputePipeline() {
        vkDestroyShaderModule(this->device->getLogicalDevice(), this->shaderModule, nullptr);
        vkDestroyPipeline(this->device->getLogicalDevice(), this->computePipeline, nullptr);
    }

    std::vector<char> ComputePipeline::readFile(const std::string &filepath) {
        std::ifstream file{filepath, std::ios::ate | std::ios::binary};

        if (!file.is_open()) {
            throw std::runtime_error("failed to open file");
        }

        size_t fileSize = static_cast<size_t>(file.tellg());
        std::vector<char> buffer(fileSize);

        file.seekg(0);
        file.read(buffer.data(), static_cast<std::streamsize>(fileSize));

        file.close();
        return buffer;
    }

    void ComputePipeline::createGraphicPipeline(VkPipelineLayout pipelineLayout,
                                                VkPipelineShaderStageCreateInfo shaderStageInfo,
                                                VkPipeline basePipelineHandleInfo, int32_t basePipelineIndex) 
    {
        VkComputePipelineCreateInfo pipelineInfo{};

        pipelineInfo.sType = VK_STRUCTURE_TYPE_COMPUTE_PIPELINE_CREATE_INFO;
        pipelineInfo.layout = pipelineLayout;
        pipelineInfo.basePipelineIndex = basePipelineIndex;
        pipelineInfo.basePipelineHandle = basePipelineHandleInfo;
        pipelineInfo.stage = shaderStageInfo;

        if (vkCreateComputePipelines(this->device->getLogicalDevice(), VK_NULL_HANDLE, 1, &pipelineInfo, nullptr,
                                     &this->computePipeline) != VK_SUCCESS) {
            throw std::runtime_error("failed to create compute pipelines");
        }

        this->shaderModule = shaderStageInfo.module;
    }

    void
    ComputePipeline::createShaderModule(Device *device, const std::vector<char> &code, VkShaderModule *shaderModule) {
        VkShaderModuleCreateInfo createInfo{};
        createInfo.sType = VK_STRUCTURE_TYPE_SHADER_MODULE_CREATE_INFO;
        createInfo.codeSize = code.size();
        createInfo.pCode = reinterpret_cast<const uint32_t *>(code.data());

        if (vkCreateShaderModule(device->getLogicalDevice(), &createInfo, nullptr, shaderModule) != VK_SUCCESS) {
            throw std::runtime_error("failed to create shader module");
        }
    }

    void ComputePipeline::bindPipeline(CommandBuffer *commandBuffer) {
        vkCmdBindPipeline(commandBuffer->getCommandBuffer(), VK_PIPELINE_BIND_POINT_COMPUTE, this->computePipeline);
    }

    void ComputePipeline::dispatch(CommandBuffer *commandBuffer, uint32_t xSize, uint32_t ySize, uint32_t zSize) {
        vkCmdDispatch(commandBuffer->getCommandBuffer(), xSize, ySize, zSize);
    }

} // namespace NugieVulkan
