#include "graphic_pipeline.hpp"

#include <fstream>
#include <iostream>
#include <stdexcept>

namespace NugieVulkan {
    GraphicPipeline::Builder::Builder(Device *device, RenderPass *renderPass, VkPipelineLayout pipelineLayout, DeviceProcedures *deviceProcedures) : 
            device{device}, deviceProcedures{deviceProcedures} {
        this->pipelineLayout = pipelineLayout;
        this->renderPass = renderPass->getRenderPass();
    }

    GraphicPipeline::Builder &GraphicPipeline::Builder::setDefault(
            const std::string &vertFilePath,
            const std::string &fragFilePath,
            const std::vector<VkPipelineColorBlendAttachmentState> &colorBlendAttachments,
            const std::vector<VkVertexInputBindingDescription> &bindingDescriptions,
            const std::vector<VkVertexInputAttributeDescription> &attributeDescriptions) {
        this->vertexInputInfo.sType = VK_STRUCTURE_TYPE_PIPELINE_VERTEX_INPUT_STATE_CREATE_INFO;
        this->vertexInputInfo.vertexAttributeDescriptionCount = static_cast<uint32_t>(attributeDescriptions.size());
        this->vertexInputInfo.vertexBindingDescriptionCount = static_cast<uint32_t>(bindingDescriptions.size());
        this->vertexInputInfo.pVertexAttributeDescriptions = (!attributeDescriptions.empty())
                                                             ? attributeDescriptions.data() : nullptr;
        this->vertexInputInfo.pVertexBindingDescriptions = (!bindingDescriptions.empty())
                                                           ? bindingDescriptions.data() : nullptr;

        this->inputAssemblyInfo.sType = VK_STRUCTURE_TYPE_PIPELINE_INPUT_ASSEMBLY_STATE_CREATE_INFO;
        this->inputAssemblyInfo.topology = VK_PRIMITIVE_TOPOLOGY_TRIANGLE_LIST;
        this->inputAssemblyInfo.primitiveRestartEnable = VK_FALSE;

        this->colorBlendInfo.sType = VK_STRUCTURE_TYPE_PIPELINE_COLOR_BLEND_STATE_CREATE_INFO;
        this->colorBlendInfo.logicOpEnable = VK_FALSE;
        this->colorBlendInfo.logicOp = VK_LOGIC_OP_COPY;  // Optional
        this->colorBlendInfo.attachmentCount = static_cast<uint32_t>(colorBlendAttachments.size());
        this->colorBlendInfo.pAttachments = !colorBlendAttachments.empty() ? colorBlendAttachments.data() : nullptr;
        this->colorBlendInfo.blendConstants[0] = 0.0f;  // Optional
        this->colorBlendInfo.blendConstants[1] = 0.0f;  // Optional
        this->colorBlendInfo.blendConstants[2] = 0.0f;  // Optional
        this->colorBlendInfo.blendConstants[3] = 0.0f;  // Optional

        this->rasterizationInfo.sType = VK_STRUCTURE_TYPE_PIPELINE_RASTERIZATION_STATE_CREATE_INFO;
        this->rasterizationInfo.depthClampEnable = VK_FALSE;
        this->rasterizationInfo.rasterizerDiscardEnable = VK_FALSE;
        this->rasterizationInfo.polygonMode = VK_POLYGON_MODE_FILL;
        this->rasterizationInfo.lineWidth = 1.0f;
        this->rasterizationInfo.cullMode = VK_CULL_MODE_BACK_BIT;
        this->rasterizationInfo.frontFace = VK_FRONT_FACE_COUNTER_CLOCKWISE;
        this->rasterizationInfo.depthBiasEnable = VK_FALSE;
        this->rasterizationInfo.depthBiasConstantFactor = 0.0f;  // Optional
        this->rasterizationInfo.depthBiasClamp = 0.0f;           // Optional
        this->rasterizationInfo.depthBiasSlopeFactor = 0.0f;     // Optional

        this->multisampleInfo.sType = VK_STRUCTURE_TYPE_PIPELINE_MULTISAMPLE_STATE_CREATE_INFO;
        this->multisampleInfo.sampleShadingEnable = VK_TRUE;
        this->multisampleInfo.rasterizationSamples = this->device->getMSAASamples();
        this->multisampleInfo.minSampleShading = 0.2f;
        this->multisampleInfo.pSampleMask = nullptr;             // Optional
        this->multisampleInfo.alphaToCoverageEnable = VK_FALSE;  // Optional
        this->multisampleInfo.alphaToOneEnable = VK_FALSE;       // Optional

        this->depthStencilInfo.sType = VK_STRUCTURE_TYPE_PIPELINE_DEPTH_STENCIL_STATE_CREATE_INFO;
        this->depthStencilInfo.depthTestEnable = VK_TRUE;
        this->depthStencilInfo.depthWriteEnable = VK_TRUE;
        this->depthStencilInfo.depthCompareOp = VK_COMPARE_OP_LESS_OR_EQUAL;
        this->depthStencilInfo.depthBoundsTestEnable = VK_FALSE;
        this->depthStencilInfo.minDepthBounds = 0.0f;  // Optional
        this->depthStencilInfo.maxDepthBounds = 1.0f;  // Optional
        this->depthStencilInfo.stencilTestEnable = VK_FALSE;
        this->depthStencilInfo.front = {};  // Optional
        this->depthStencilInfo.back = {};   // Optional

        this->dynamicStates = {VK_DYNAMIC_STATE_VIEWPORT, VK_DYNAMIC_STATE_SCISSOR};

        this->dynamicStateInfo.sType = VK_STRUCTURE_TYPE_PIPELINE_DYNAMIC_STATE_CREATE_INFO;
        this->dynamicStateInfo.dynamicStateCount = static_cast<uint32_t>(this->dynamicStates.size());
        this->dynamicStateInfo.pDynamicStates = !this->dynamicStates.empty() ? this->dynamicStates.data() : nullptr;
        this->dynamicStateInfo.flags = 0;

        this->tessellationInfo.sType = VK_STRUCTURE_TYPE_PIPELINE_TESSELLATION_STATE_CREATE_INFO;
        this->tessellationInfo.patchControlPoints = 0;
        this->tessellationInfo.flags = 0;

        this->subpass = 0u;

        VkShaderModule vertShaderModule;
        VkShaderModule fragShaderModule;

        auto vertCode = GraphicPipeline::readFile(vertFilePath);
        auto fragCode = GraphicPipeline::readFile(fragFilePath);

        GraphicPipeline::createShaderModule(this->device, vertCode, &vertShaderModule);
        GraphicPipeline::createShaderModule(this->device, fragCode, &fragShaderModule);

        VkPipelineShaderStageCreateInfo vertexShaderStageInfo{};
        vertexShaderStageInfo.sType = VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO;
        vertexShaderStageInfo.stage = VK_SHADER_STAGE_VERTEX_BIT;
        vertexShaderStageInfo.module = vertShaderModule;
        vertexShaderStageInfo.pName = "main";
        vertexShaderStageInfo.flags = 0;
        vertexShaderStageInfo.pNext = nullptr;
        vertexShaderStageInfo.pSpecializationInfo = nullptr;

        VkPipelineShaderStageCreateInfo fragmentShaderStageInfo{};
        fragmentShaderStageInfo.sType = VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO;
        fragmentShaderStageInfo.stage = VK_SHADER_STAGE_FRAGMENT_BIT;
        fragmentShaderStageInfo.module = fragShaderModule;
        fragmentShaderStageInfo.pName = "main";
        fragmentShaderStageInfo.flags = 0;
        fragmentShaderStageInfo.pNext = nullptr;
        fragmentShaderStageInfo.pSpecializationInfo = nullptr;

        this->shaderStagesInfo = {vertexShaderStageInfo, fragmentShaderStageInfo};
        return *this;
    }

    GraphicPipeline::Builder &GraphicPipeline::Builder::setDefault(
            const std::vector<VkVertexInputBindingDescription> &bindingDescriptions,
            const std::vector<VkVertexInputAttributeDescription> &attributeDescriptions
    ) {
        this->vertexInputInfo.sType = VK_STRUCTURE_TYPE_PIPELINE_VERTEX_INPUT_STATE_CREATE_INFO;
        this->vertexInputInfo.vertexAttributeDescriptionCount = static_cast<uint32_t>(attributeDescriptions.size());
        this->vertexInputInfo.vertexBindingDescriptionCount = static_cast<uint32_t>(bindingDescriptions.size());
        this->vertexInputInfo.pVertexAttributeDescriptions = (!attributeDescriptions.empty())
                                                             ? attributeDescriptions.data() : nullptr;
        this->vertexInputInfo.pVertexBindingDescriptions = (!bindingDescriptions.empty())
                                                           ? bindingDescriptions.data() : nullptr;

        this->inputAssemblyInfo.sType = VK_STRUCTURE_TYPE_PIPELINE_INPUT_ASSEMBLY_STATE_CREATE_INFO;
        this->inputAssemblyInfo.topology = VK_PRIMITIVE_TOPOLOGY_TRIANGLE_LIST;
        this->inputAssemblyInfo.primitiveRestartEnable = VK_FALSE;

        this->colorBlendInfo.sType = VK_STRUCTURE_TYPE_PIPELINE_COLOR_BLEND_STATE_CREATE_INFO;
        this->colorBlendInfo.logicOpEnable = VK_FALSE;
        this->colorBlendInfo.logicOp = VK_LOGIC_OP_COPY;  // Optional
        this->colorBlendInfo.attachmentCount = 0;
        this->colorBlendInfo.pAttachments = nullptr;

        this->rasterizationInfo.sType = VK_STRUCTURE_TYPE_PIPELINE_RASTERIZATION_STATE_CREATE_INFO;
        this->rasterizationInfo.depthClampEnable = VK_FALSE;
        this->rasterizationInfo.rasterizerDiscardEnable = VK_FALSE;
        this->rasterizationInfo.polygonMode = VK_POLYGON_MODE_FILL;
        this->rasterizationInfo.lineWidth = 1.0f;
        this->rasterizationInfo.cullMode = VK_CULL_MODE_BACK_BIT;
        this->rasterizationInfo.frontFace = VK_FRONT_FACE_CLOCKWISE;
        this->rasterizationInfo.depthBiasEnable = VK_FALSE;
        this->rasterizationInfo.depthBiasConstantFactor = 0.0f;  // Optional
        this->rasterizationInfo.depthBiasClamp = 0.0f;           // Optional
        this->rasterizationInfo.depthBiasSlopeFactor = 0.0f;     // Optional

        this->multisampleInfo.sType = VK_STRUCTURE_TYPE_PIPELINE_MULTISAMPLE_STATE_CREATE_INFO;
        this->multisampleInfo.sampleShadingEnable = VK_TRUE;
        this->multisampleInfo.rasterizationSamples = this->device->getMSAASamples();
        this->multisampleInfo.minSampleShading = 0.2f;
        this->multisampleInfo.pSampleMask = nullptr;             // Optional
        this->multisampleInfo.alphaToCoverageEnable = VK_FALSE;  // Optional
        this->multisampleInfo.alphaToOneEnable = VK_FALSE;       // Optional

        this->depthStencilInfo.sType = VK_STRUCTURE_TYPE_PIPELINE_DEPTH_STENCIL_STATE_CREATE_INFO;
        this->depthStencilInfo.depthTestEnable = VK_TRUE;
        this->depthStencilInfo.depthWriteEnable = VK_TRUE;
        this->depthStencilInfo.depthCompareOp = VK_COMPARE_OP_LESS_OR_EQUAL;
        this->depthStencilInfo.depthBoundsTestEnable = VK_FALSE;
        this->depthStencilInfo.minDepthBounds = 0.0f;  // Optional
        this->depthStencilInfo.maxDepthBounds = 1.0f;  // Optional
        this->depthStencilInfo.stencilTestEnable = VK_FALSE;
        this->depthStencilInfo.front = {};  // Optional
        this->depthStencilInfo.back = {};   // Optional

        this->dynamicStates = {VK_DYNAMIC_STATE_VIEWPORT, VK_DYNAMIC_STATE_SCISSOR};

        this->dynamicStateInfo.sType = VK_STRUCTURE_TYPE_PIPELINE_DYNAMIC_STATE_CREATE_INFO;
        this->dynamicStateInfo.dynamicStateCount = static_cast<uint32_t>(this->dynamicStates.size());
        this->dynamicStateInfo.pDynamicStates = !this->dynamicStates.empty() ? this->dynamicStates.data() : nullptr;
        this->dynamicStateInfo.flags = 0;

        this->tessellationInfo.sType = VK_STRUCTURE_TYPE_PIPELINE_TESSELLATION_STATE_CREATE_INFO;
        this->tessellationInfo.patchControlPoints = 0;
        this->tessellationInfo.flags = 0;

        this->subpass = 0u;

        return *this;
    }

    GraphicPipeline::Builder &GraphicPipeline::Builder::setDefault(
            const std::vector<VkPipelineColorBlendAttachmentState> &colorBlendAttachments,
            const std::vector<VkVertexInputBindingDescription> &bindingDescriptions,
            const std::vector<VkVertexInputAttributeDescription> &attributeDescriptions
    ) {
        this->vertexInputInfo.sType = VK_STRUCTURE_TYPE_PIPELINE_VERTEX_INPUT_STATE_CREATE_INFO;
        this->vertexInputInfo.vertexAttributeDescriptionCount = static_cast<uint32_t>(attributeDescriptions.size());
        this->vertexInputInfo.vertexBindingDescriptionCount = static_cast<uint32_t>(bindingDescriptions.size());
        this->vertexInputInfo.pVertexAttributeDescriptions = (!attributeDescriptions.empty())
                                                             ? attributeDescriptions.data() : nullptr;
        this->vertexInputInfo.pVertexBindingDescriptions = (!bindingDescriptions.empty())
                                                           ? bindingDescriptions.data() : nullptr;

        this->inputAssemblyInfo.sType = VK_STRUCTURE_TYPE_PIPELINE_INPUT_ASSEMBLY_STATE_CREATE_INFO;
        this->inputAssemblyInfo.topology = VK_PRIMITIVE_TOPOLOGY_TRIANGLE_LIST;
        this->inputAssemblyInfo.primitiveRestartEnable = VK_FALSE;

        this->colorBlendInfo.sType = VK_STRUCTURE_TYPE_PIPELINE_COLOR_BLEND_STATE_CREATE_INFO;
        this->colorBlendInfo.logicOpEnable = VK_FALSE;
        this->colorBlendInfo.logicOp = VK_LOGIC_OP_COPY;  // Optional
        this->colorBlendInfo.attachmentCount = static_cast<uint32_t>(colorBlendAttachments.size());
        this->colorBlendInfo.pAttachments = !colorBlendAttachments.empty() ? colorBlendAttachments.data() : nullptr;
        this->colorBlendInfo.blendConstants[0] = 0.0f;  // Optional
        this->colorBlendInfo.blendConstants[1] = 0.0f;  // Optional
        this->colorBlendInfo.blendConstants[2] = 0.0f;  // Optional
        this->colorBlendInfo.blendConstants[3] = 0.0f;  // Optional

        this->rasterizationInfo.sType = VK_STRUCTURE_TYPE_PIPELINE_RASTERIZATION_STATE_CREATE_INFO;
        this->rasterizationInfo.depthClampEnable = VK_FALSE;
        this->rasterizationInfo.rasterizerDiscardEnable = VK_FALSE;
        this->rasterizationInfo.polygonMode = VK_POLYGON_MODE_FILL;
        this->rasterizationInfo.lineWidth = 1.0f;
        this->rasterizationInfo.cullMode = VK_CULL_MODE_BACK_BIT;
        this->rasterizationInfo.frontFace = VK_FRONT_FACE_COUNTER_CLOCKWISE;
        this->rasterizationInfo.depthBiasEnable = VK_FALSE;
        this->rasterizationInfo.depthBiasConstantFactor = 0.0f;  // Optional
        this->rasterizationInfo.depthBiasClamp = 0.0f;           // Optional
        this->rasterizationInfo.depthBiasSlopeFactor = 0.0f;     // Optional

        this->multisampleInfo.sType = VK_STRUCTURE_TYPE_PIPELINE_MULTISAMPLE_STATE_CREATE_INFO;
        this->multisampleInfo.sampleShadingEnable = VK_TRUE;
        this->multisampleInfo.rasterizationSamples = this->device->getMSAASamples();
        this->multisampleInfo.minSampleShading = 0.2f;
        this->multisampleInfo.pSampleMask = nullptr;             // Optional
        this->multisampleInfo.alphaToCoverageEnable = VK_FALSE;  // Optional
        this->multisampleInfo.alphaToOneEnable = VK_FALSE;       // Optional

        this->depthStencilInfo.sType = VK_STRUCTURE_TYPE_PIPELINE_DEPTH_STENCIL_STATE_CREATE_INFO;
        this->depthStencilInfo.depthTestEnable = VK_TRUE;
        this->depthStencilInfo.depthWriteEnable = VK_TRUE;
        this->depthStencilInfo.depthCompareOp = VK_COMPARE_OP_LESS_OR_EQUAL;
        this->depthStencilInfo.depthBoundsTestEnable = VK_FALSE;
        this->depthStencilInfo.minDepthBounds = 0.0f;  // Optional
        this->depthStencilInfo.maxDepthBounds = 1.0f;  // Optional
        this->depthStencilInfo.stencilTestEnable = VK_FALSE;
        this->depthStencilInfo.front = {};  // Optional
        this->depthStencilInfo.back = {};   // Optional

        this->dynamicStates = {VK_DYNAMIC_STATE_VIEWPORT, VK_DYNAMIC_STATE_SCISSOR};

        this->dynamicStateInfo.sType = VK_STRUCTURE_TYPE_PIPELINE_DYNAMIC_STATE_CREATE_INFO;
        this->dynamicStateInfo.dynamicStateCount = static_cast<uint32_t>(this->dynamicStates.size());
        this->dynamicStateInfo.pDynamicStates = !this->dynamicStates.empty() ? this->dynamicStates.data() : nullptr;
        this->dynamicStateInfo.flags = 0;

        this->tessellationInfo.sType = VK_STRUCTURE_TYPE_PIPELINE_TESSELLATION_STATE_CREATE_INFO;
        this->tessellationInfo.patchControlPoints = 0;
        this->tessellationInfo.flags = 0;

        this->subpass = 0u;

        return *this;
    }

    GraphicPipeline::Builder &GraphicPipeline::Builder::setSubpass(uint32_t subpass) {
        this->subpass = subpass;
        return *this;
    }

    GraphicPipeline::Builder &
    GraphicPipeline::Builder::setVertexInputInfo(VkPipelineVertexInputStateCreateInfo vertexInputInfo) {
        this->vertexInputInfo = vertexInputInfo;
        return *this;
    }

    GraphicPipeline::Builder &
    GraphicPipeline::Builder::setInputAssemblyInfo(VkPipelineInputAssemblyStateCreateInfo inputAssemblyInfo) {
        this->inputAssemblyInfo = inputAssemblyInfo;
        return *this;
    }

    GraphicPipeline::Builder &
    GraphicPipeline::Builder::setRasterizationInfo(VkPipelineRasterizationStateCreateInfo rasterizationInfo) {
        this->rasterizationInfo = rasterizationInfo;
        return *this;
    }

    GraphicPipeline::Builder &
    GraphicPipeline::Builder::setMultisampleInfo(VkPipelineMultisampleStateCreateInfo multisampleInfo) {
        this->multisampleInfo = multisampleInfo;
        return *this;
    }

    GraphicPipeline::Builder &
    GraphicPipeline::Builder::setColorBlendInfo(VkPipelineColorBlendStateCreateInfo colorBlendInfo) {
        this->colorBlendInfo = colorBlendInfo;
        return *this;
    }

    GraphicPipeline::Builder &
    GraphicPipeline::Builder::setDepthStencilInfo(VkPipelineDepthStencilStateCreateInfo depthStencilInfo) {
        this->depthStencilInfo = depthStencilInfo;
        return *this;
    }

    GraphicPipeline::Builder &
    GraphicPipeline::Builder::setDynamicStateInfo(VkPipelineDynamicStateCreateInfo dynamicStateInfo) {
        this->dynamicStateInfo = dynamicStateInfo;
        return *this;
    }

    GraphicPipeline::Builder &GraphicPipeline::Builder::setShaderStagesInfo(
            const std::vector<VkPipelineShaderStageCreateInfo> &shaderStagesInfo) {
        this->shaderStagesInfo = shaderStagesInfo;
        return *this;
    }

    GraphicPipeline::Builder &
    GraphicPipeline::Builder::setTessellationInfo(VkPipelineTessellationStateCreateInfo tessellationInfo) {
        this->tessellationInfo = tessellationInfo;
        return *this;
    }

    GraphicPipeline::Builder &
    GraphicPipeline::Builder::addShaderStage(VkShaderStageFlagBits shaderStage, const std::string &shaderFilePath) {
        auto shaderCode = GraphicPipeline::readFile(shaderFilePath);
        VkShaderModule shaderModule;

        GraphicPipeline::createShaderModule(this->device, shaderCode, &shaderModule);

        VkPipelineShaderStageCreateInfo shaderStageInfo{};
        shaderStageInfo.sType = VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO;
        shaderStageInfo.stage = shaderStage;
        shaderStageInfo.module = shaderModule;
        shaderStageInfo.pName = "main";
        shaderStageInfo.flags = 0;
        shaderStageInfo.pNext = nullptr;
        shaderStageInfo.pSpecializationInfo = nullptr;

        this->shaderStagesInfo.emplace_back(shaderStageInfo);

        return *this;
    }

    GraphicPipeline::Builder &
    GraphicPipeline::Builder::setIsMeshShader(bool isMeshShader) {
        this->isMeshShader = isMeshShader;

        return *this;
    }

    GraphicPipeline *GraphicPipeline::Builder::build() {
        return new GraphicPipeline(
                this->device,                
                this->pipelineLayout,
                this->renderPass,
                this->subpass,
                this->vertexInputInfo,
                this->inputAssemblyInfo,
                this->rasterizationInfo,
                this->multisampleInfo,
                this->colorBlendInfo,
                this->depthStencilInfo,
                this->dynamicStateInfo,
                this->shaderStagesInfo,
                this->tessellationInfo,
                this->isMeshShader,
                this->deviceProcedures
        );
    }

    GraphicPipeline::GraphicPipeline(
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
            bool isMeshShader,
            DeviceProcedures *deviceProcedures
    ) : device{device}, deviceProcedures{deviceProcedures} {
        this->createGraphicPipeline(
                pipelineLayout,
                renderPass,
                subpass,
                vertexInputInfo,
                inputAssemblyInfo,
                rasterizationInfo,
                multisampleInfo,
                colorBlendInfo,
                depthStencilInfo,
                dynamicStateInfo,
                shaderStagesInfo,
                tessellationInfo,
                isMeshShader
        );
    }

    GraphicPipeline::~GraphicPipeline() {
        for (auto &shaderModule: this->shaderModules) {
            vkDestroyShaderModule(this->device->getLogicalDevice(), shaderModule, nullptr);
        }

        vkDestroyPipeline(this->device->getLogicalDevice(), this->graphicPipeline, nullptr);
    }

    std::vector<char> GraphicPipeline::readFile(const std::string &filepath) {
        std::ifstream file{filepath, std::ios::ate | std::ios::binary};

        if (!file.is_open()) {
            throw std::runtime_error("failed to open file");
        }

        size_t fileSize = static_cast<size_t>(file.tellg());
        std::vector<char> buffer(fileSize);

        file.seekg(0);
        file.read(buffer.data(), static_cast<std::streamsize >(fileSize));

        file.close();
        return buffer;
    }

    void GraphicPipeline::createGraphicPipeline(
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
            bool isMeshShader) {
        VkPipelineViewportStateCreateInfo viewportInfo{};
        viewportInfo.sType = VK_STRUCTURE_TYPE_PIPELINE_VIEWPORT_STATE_CREATE_INFO;
        viewportInfo.viewportCount = 1;
        viewportInfo.scissorCount = 1;

        VkGraphicsPipelineCreateInfo pipelineInfo{};
        pipelineInfo.sType = VK_STRUCTURE_TYPE_GRAPHICS_PIPELINE_CREATE_INFO;
        pipelineInfo.stageCount = static_cast<uint32_t>(shaderStagesInfo.size());
        pipelineInfo.pStages = (!shaderStagesInfo.empty()) ? shaderStagesInfo.data() : nullptr;
        pipelineInfo.pVertexInputState = (isMeshShader) ? VK_NULL_HANDLE : &vertexInputInfo;
        pipelineInfo.pInputAssemblyState = (isMeshShader) ? VK_NULL_HANDLE : &inputAssemblyInfo;
        pipelineInfo.pViewportState = &viewportInfo;
        pipelineInfo.pRasterizationState = &rasterizationInfo;
        pipelineInfo.pMultisampleState = &multisampleInfo;
        pipelineInfo.pColorBlendState = &colorBlendInfo;
        pipelineInfo.pDepthStencilState = &depthStencilInfo;
        pipelineInfo.pDynamicState = &dynamicStateInfo;
        pipelineInfo.pTessellationState = &tessellationInfo;

        pipelineInfo.layout = pipelineLayout;
        pipelineInfo.renderPass = renderPass;
        pipelineInfo.subpass = subpass;

        pipelineInfo.basePipelineIndex = -1;
        pipelineInfo.basePipelineHandle = VK_NULL_HANDLE;

        if (vkCreateGraphicsPipelines(this->device->getLogicalDevice(), VK_NULL_HANDLE, 1, &pipelineInfo, nullptr,
                                      &this->graphicPipeline) != VK_SUCCESS) {
            throw std::runtime_error("failed to create graphic pipelines");
        }

        this->shaderModules.clear();
        for (auto &shaderStage: shaderStagesInfo) {
            this->shaderModules.push_back(shaderStage.module);
        }
    }

    void
    GraphicPipeline::createShaderModule(Device *device, const std::vector<char> &code, VkShaderModule *shaderModule) {
        VkShaderModuleCreateInfo createInfo{};
        createInfo.sType = VK_STRUCTURE_TYPE_SHADER_MODULE_CREATE_INFO;
        createInfo.codeSize = code.size();
        createInfo.pCode = reinterpret_cast<const uint32_t *>(code.data());

        if (vkCreateShaderModule(device->getLogicalDevice(), &createInfo, nullptr, shaderModule) != VK_SUCCESS) {
            throw std::runtime_error("failed to create shader module");
        }
    }

    void GraphicPipeline::bindPipeline(CommandBuffer *commandBuffer) {
        vkCmdBindPipeline(commandBuffer->getCommandBuffer(), VK_PIPELINE_BIND_POINT_GRAPHICS, this->graphicPipeline);
    }

    void GraphicPipeline::bindBuffers(CommandBuffer *commandBuffer, const std::vector<Buffer *> &vertexBuffers,
                                      const std::vector<VkDeviceSize> &vertexOffsets,
                                      Buffer *indexBuffer, VkDeviceSize indexOffset) {
        std::vector<VkBuffer> vBuffers;

        vBuffers.reserve(vertexBuffers.size());
        for (auto &&vertexBuffer: vertexBuffers) {
            vBuffers.emplace_back(vertexBuffer->getBuffer());
        }

        vkCmdBindVertexBuffers(commandBuffer->getCommandBuffer(), 0u, static_cast<uint32_t>(vertexBuffers.size()),
                               vBuffers.data(), vertexOffsets.data());

        if (indexBuffer != nullptr) {
            vkCmdBindIndexBuffer(commandBuffer->getCommandBuffer(), indexBuffer->getBuffer(), indexOffset,
                                 VK_INDEX_TYPE_UINT32);
        }
    }

    void GraphicPipeline::draw(CommandBuffer *commandBuffer, uint32_t vertexCount, uint32_t instanceCount) {
        vkCmdDraw(commandBuffer->getCommandBuffer(), vertexCount, instanceCount, 0, 0);
    }

    void GraphicPipeline::drawIndirect(CommandBuffer *commandBuffer, NugieVulkan::Buffer *drawCommandBuffer,
                                       uint32_t offset, uint32_t drawCount) {
        vkCmdDrawIndirect(commandBuffer->getCommandBuffer(), drawCommandBuffer->getBuffer(), offset, drawCount,
                          static_cast<uint32_t>(sizeof(VkDrawIndexedIndirectCommand)));
    }

    void GraphicPipeline::drawIndexed(CommandBuffer *commandBuffer, uint32_t indexCount, uint32_t instanceCount) {
        vkCmdDrawIndexed(commandBuffer->getCommandBuffer(), indexCount, instanceCount, 0, 0, 0);
    }

    void GraphicPipeline::drawIndirectIndexed(CommandBuffer *commandBuffer, NugieVulkan::Buffer *drawCommandBuffer,
                                              uint32_t indexCount, uint32_t offset) {
        vkCmdDrawIndexedIndirect(commandBuffer->getCommandBuffer(), drawCommandBuffer->getBuffer(), offset, indexCount,
                                 static_cast<uint32_t>(sizeof(VkDrawIndexedIndirectCommand)));
    }

    void GraphicPipeline::drawMeshShader(CommandBuffer *commandBuffer, uint32_t xSize, uint32_t ySize, uint32_t zSize) {
        if (this->deviceProcedures == nullptr)
            throw std::runtime_error("device procedures cannot be null");

        this->deviceProcedures->vkCmdDrawMeshTasksEXT(commandBuffer->getCommandBuffer(), xSize, ySize, zSize);
    }
} // namespace NugieVulkan
