#include "shadow_sub_renderer.hpp"

#include <assert.h>
#include <array>

namespace NugieApp {
  ShadowSubRenderer::Builder::Builder(NugieVulkan::Device* device, uint32_t width, uint32_t height, uint32_t layerNum) 
    : device{device}, width{width}, height{height}, layerNum{layerNum}
  {

  }

  ShadowSubRenderer::Builder& ShadowSubRenderer::Builder::addSubPass(std::vector<std::vector<VkImageView>> attachments, std::vector<VkAttachmentDescription> attachmentDescs, 
    std::vector<VkAttachmentReference> outputAttachmentRefs, VkAttachmentReference depthAttachmentRefs, std::vector<VkAttachmentReference> inputAttachmentRefs) 
  {
    for (auto &&attachment : attachments) {
      this->attachments.emplace_back(attachment);
    }

    for (auto &&attachmentDesc : attachmentDescs) {
      this->attachmentDescs.emplace_back(attachmentDesc);
    }
    
    this->outputAttachmentRefs.emplace_back(outputAttachmentRefs);
    this->inputAttachmentRefs.emplace_back(inputAttachmentRefs);
    this->depthAttachmentRefs.emplace_back(depthAttachmentRefs);

    return *this;
  }

  ShadowSubRenderer::Builder& ShadowSubRenderer::Builder::addResolveAttachmentRef(VkAttachmentReference resolveAttachmentRef) {
    this->resolveAttachmentRef.clear();
    this->resolveAttachmentRef.emplace_back(resolveAttachmentRef);

    return *this;
  }

  ShadowSubRenderer* ShadowSubRenderer::Builder::build() {
    return new ShadowSubRenderer(this->device, this->width, this->height, this->layerNum, this->attachments, this->attachmentDescs, 
      this->outputAttachmentRefs, this->depthAttachmentRefs, this->inputAttachmentRefs, this->resolveAttachmentRef);
  }

  ShadowSubRenderer::ShadowSubRenderer(NugieVulkan::Device* device, uint32_t width, uint32_t height, uint32_t layerNum, 
    std::vector<std::vector<VkImageView>> attachments, std::vector<VkAttachmentDescription> attachmentDescs, 
    std::vector<std::vector<VkAttachmentReference>> outputAttachmentRefs, std::vector<VkAttachmentReference> depthAttachmentRefs, 
    std::vector<std::vector<VkAttachmentReference>> inputAttachmentRefs, std::vector<VkAttachmentReference> resolveAttachmentRef)
    : SubRenderer(device, width, height, layerNum, attachments, attachmentDescs, outputAttachmentRefs, depthAttachmentRefs, inputAttachmentRefs, resolveAttachmentRef)
  {

  }

  void ShadowSubRenderer::beginRenderPass(NugieVulkan::CommandBuffer* commandBuffer, uint32_t imageIndex) {
		SubRenderer::beginRenderPass(commandBuffer, imageIndex);
    vkCmdSetDepthBias(commandBuffer->getCommandBuffer(), 1.0f, 0.0f, 1.0f);
	}
  
} // namespace NugieApp
