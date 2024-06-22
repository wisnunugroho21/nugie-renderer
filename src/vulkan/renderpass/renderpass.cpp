#include "renderpass.hpp"

#include <array>

namespace NugieVulkan {
    RenderPass::Builder::Builder(Device *device, uint32_t width, uint32_t height, uint32_t layerNum) :
            device{device}, width{width}, height{height}, layerNum{layerNum} {

    }

    RenderPass::Builder &RenderPass::Builder::addSubpass(VkSubpassDescription subpass) {
        this->subpasses.push_back(subpass);
        return *this;
    }

    RenderPass::Builder &RenderPass::Builder::addAttachment(VkAttachmentDescription attachment) {
        this->attachments.push_back(attachment);
        return *this;
    }

    RenderPass::Builder &RenderPass::Builder::addAttachments(const std::vector<VkAttachmentDescription> &attachments) {
        for (auto &&attachment: attachments) {
            this->attachments.push_back(attachment);
        }

        return *this;
    }

    RenderPass::Builder &RenderPass::Builder::addDependency(VkSubpassDependency dependency) {
        this->dependencies.push_back(dependency);
        return *this;
    }

    RenderPass::Builder &RenderPass::Builder::addViewImages(const std::vector<VkImageView> &viewImages) {
        this->viewImages.push_back(viewImages);
        return *this;
    }

    RenderPass *RenderPass::Builder::build() {
        VkRenderPassCreateInfo renderPassInfo = {};
        renderPassInfo.sType = VK_STRUCTURE_TYPE_RENDER_PASS_CREATE_INFO;
        renderPassInfo.attachmentCount = static_cast<uint32_t>(this->attachments.size());
        renderPassInfo.pAttachments = this->attachments.data();
        renderPassInfo.subpassCount = static_cast<uint32_t>(this->subpasses.size());
        renderPassInfo.pSubpasses = this->subpasses.data();
        renderPassInfo.dependencyCount = static_cast<uint32_t>(this->dependencies.size());
        renderPassInfo.pDependencies = this->dependencies.data();

        return new RenderPass(this->device, this->viewImages, renderPassInfo, this->width, this->height,
                              this->layerNum);
    }

    RenderPass::RenderPass(Device *device, const std::vector<std::vector<VkImageView>> &viewImages,
                           VkRenderPassCreateInfo renderPassInfo, uint32_t width, uint32_t height, uint32_t layerNum)
                           : device{device} 
    {
        this->createRenderPass(renderPassInfo);
        this->createFramebuffers(viewImages, width, height, layerNum);
    }

    RenderPass::~RenderPass() {
        this->deleteFramebuffers();
        vkDestroyRenderPass(this->device->getLogicalDevice(), this->renderPass, nullptr);
    }

    void RenderPass::createRenderPass(VkRenderPassCreateInfo renderPassInfo) {
        if (vkCreateRenderPass(this->device->getLogicalDevice(), &renderPassInfo, nullptr, &renderPass) != VK_SUCCESS) {
            throw std::runtime_error("failed to create render pass!");
        }
    }

    void RenderPass::createFramebuffers(const std::vector<std::vector<VkImageView>> &viewImages, uint32_t width,
                                        uint32_t height, uint32_t layerNum) 
    {
        this->framebuffers.resize(viewImages.size());

        for (size_t i = 0; i < viewImages.size(); i++) {
            VkFramebufferCreateInfo framebufferInfo = {};
            framebufferInfo.sType = VK_STRUCTURE_TYPE_FRAMEBUFFER_CREATE_INFO;
            framebufferInfo.renderPass = this->renderPass;
            framebufferInfo.attachmentCount = static_cast<uint32_t>(viewImages[i].size());
            framebufferInfo.pAttachments = viewImages[i].data();
            framebufferInfo.width = width;
            framebufferInfo.height = height;
            framebufferInfo.layers = layerNum;

            if (vkCreateFramebuffer(
                    this->device->getLogicalDevice(),
                    &framebufferInfo,
                    nullptr,
                    &this->framebuffers[i]) != VK_SUCCESS) {
                throw std::runtime_error("failed to create framebuffer!");
            }
        }
    }

    void RenderPass::recreateFrameBuffer(const std::vector<std::vector<VkImageView>> &viewImages, uint32_t width,
                                         uint32_t height, uint32_t layerNum) 
    {
        this->deleteFramebuffers();
        this->createFramebuffers(viewImages, width, height, layerNum);
    }

    void RenderPass::deleteFramebuffers() {
        for (auto framebuffer: this->framebuffers) {
            vkDestroyFramebuffer(this->device->getLogicalDevice(), framebuffer, nullptr);
        }
    }
} // namespace NugieVulkan
