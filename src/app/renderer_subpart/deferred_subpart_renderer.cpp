#include "deferred_subpart_renderer.hpp"

#include <assert.h>
#include <array>

namespace NugieApp {
  DeferredSubPartRenderer::DeferredSubPartRenderer(NugieVulkan::Device* device, std::vector<NugieVulkan::Image*> swapChainImages, VkFormat swapChainImageFormat, uint32_t imageCount, uint32_t width, uint32_t height) 
    : device{device}, swapChainImages{swapChainImages}, swapChainImageFormat{swapChainImageFormat}, width{width}, height{height}
  {
    this->createDeferredResources(imageCount);
  }

  DeferredSubPartRenderer::~DeferredSubPartRenderer() {
    for (auto &&colorImage : this->deferredColorImages) {
      if (colorImage != nullptr) delete colorImage;
    }

    for (auto &&depthImage : this->deferredDepthImages) {
      if (depthImage != nullptr) delete depthImage;
    }
  }

  std::vector<std::vector<VkImageView>> DeferredSubPartRenderer::getAttachments() {
    std::vector<std::vector<VkImageView>> attachments;

    std::vector<VkImageView> deferredColorAttachment;
    for (size_t i = 0; i < this->deferredColorImages.size(); i++) {
      deferredColorAttachment.emplace_back(this->deferredColorImages[i]->getImageView());
    }

    attachments.emplace_back(deferredColorAttachment);

    std::vector<VkImageView> deferredDepthAttachment;
    for (size_t i = 0; i < this->deferredDepthImages.size(); i++) {
      deferredDepthAttachment.emplace_back(this->deferredDepthImages[i]->getImageView());
    }

    attachments.emplace_back(deferredDepthAttachment);

    std::vector<VkImageView> swapChainAttachment;
    for (size_t i = 0; i < this->swapChainImages.size(); i++) {
      swapChainAttachment.emplace_back(this->swapChainImages[i]->getImageView());
    }

    attachments.emplace_back(swapChainAttachment);

    return attachments;
  }

  std::vector<VkAttachmentDescription> DeferredSubPartRenderer::getAttachmentDescs() {
    VkFormat colorFormat = this->swapChainImageFormat;
    VkFormat depthFormat = this->findDepthFormat();

    auto msaaSamples = this->device->getMSAASamples();

    VkAttachmentDescription deferredColorAttachment{};
    deferredColorAttachment.format = colorFormat;
    deferredColorAttachment.samples = msaaSamples;
    deferredColorAttachment.loadOp = VK_ATTACHMENT_LOAD_OP_CLEAR;
    deferredColorAttachment.storeOp = VK_ATTACHMENT_STORE_OP_DONT_CARE;
    deferredColorAttachment.stencilStoreOp = VK_ATTACHMENT_STORE_OP_DONT_CARE;
    deferredColorAttachment.stencilLoadOp = VK_ATTACHMENT_LOAD_OP_DONT_CARE;
    deferredColorAttachment.initialLayout = VK_IMAGE_LAYOUT_UNDEFINED;
    deferredColorAttachment.finalLayout = VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL;

    VkAttachmentDescription deferredDepthAttachment{};
    deferredDepthAttachment.format = depthFormat;
    deferredDepthAttachment.samples = msaaSamples;
    deferredDepthAttachment.loadOp = VK_ATTACHMENT_LOAD_OP_CLEAR;
    deferredDepthAttachment.storeOp = VK_ATTACHMENT_STORE_OP_DONT_CARE;
    deferredDepthAttachment.stencilLoadOp = VK_ATTACHMENT_LOAD_OP_DONT_CARE;
    deferredDepthAttachment.stencilStoreOp = VK_ATTACHMENT_STORE_OP_DONT_CARE;
    deferredDepthAttachment.initialLayout = VK_IMAGE_LAYOUT_UNDEFINED;
    deferredDepthAttachment.finalLayout = VK_IMAGE_LAYOUT_DEPTH_STENCIL_ATTACHMENT_OPTIMAL;

    VkAttachmentDescription resolveAttachment{};
    resolveAttachment.format = swapChainImageFormat;
    resolveAttachment.samples = VK_SAMPLE_COUNT_1_BIT;
    resolveAttachment.loadOp = VK_ATTACHMENT_LOAD_OP_DONT_CARE;
    resolveAttachment.storeOp = VK_ATTACHMENT_STORE_OP_STORE;
    resolveAttachment.stencilLoadOp = VK_ATTACHMENT_LOAD_OP_DONT_CARE;
    resolveAttachment.stencilStoreOp = VK_ATTACHMENT_STORE_OP_DONT_CARE;
    resolveAttachment.initialLayout = VK_IMAGE_LAYOUT_UNDEFINED;
    resolveAttachment.finalLayout = VK_IMAGE_LAYOUT_PRESENT_SRC_KHR;

    std::vector<VkAttachmentDescription> attachmentDescs;
    attachmentDescs.emplace_back(deferredColorAttachment);
    attachmentDescs.emplace_back(deferredDepthAttachment);
    attachmentDescs.emplace_back(resolveAttachment);

    return attachmentDescs;
  }

  std::vector<VkAttachmentReference> DeferredSubPartRenderer::getOutputAttachmentRefs() {
    VkAttachmentReference deferredColorAttachmentRef{};
    deferredColorAttachmentRef.attachment = 6;
    deferredColorAttachmentRef.layout = VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL;

    std::vector<VkAttachmentReference> outputAttachmentRefs;
    outputAttachmentRefs.emplace_back(deferredColorAttachmentRef);

    return outputAttachmentRefs;
  }

  std::vector<VkAttachmentReference> DeferredSubPartRenderer::getInputAttachmentRefs() {
    VkAttachmentReference deferredPositionInputRef;
    deferredPositionInputRef.attachment = 0;
    deferredPositionInputRef.layout = VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL;

    VkAttachmentReference deferredNormalInputRef;
    deferredNormalInputRef.attachment = 1;
    deferredNormalInputRef.layout = VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL;

    VkAttachmentReference deferredColorInputRef;
    deferredColorInputRef.attachment = 2;
    deferredColorInputRef.layout = VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL;

    VkAttachmentReference deferredMaterialInputRef;
    deferredMaterialInputRef.attachment = 3;
    deferredMaterialInputRef.layout = VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL;

    VkAttachmentReference deferredShadowCoordInputRef;
    deferredShadowCoordInputRef.attachment = 4;
    deferredShadowCoordInputRef.layout = VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL;
    
    std::vector<VkAttachmentReference> inputAttachmentRefs;
    inputAttachmentRefs.emplace_back(deferredPositionInputRef);
    inputAttachmentRefs.emplace_back(deferredNormalInputRef);
    inputAttachmentRefs.emplace_back(deferredColorInputRef);
    inputAttachmentRefs.emplace_back(deferredMaterialInputRef);
    inputAttachmentRefs.emplace_back(deferredShadowCoordInputRef);

    return inputAttachmentRefs;
  }

  VkAttachmentReference DeferredSubPartRenderer::getDepthAttachmentRef() {
    VkAttachmentReference deferredDepthAttachmentRef{};
    deferredDepthAttachmentRef.attachment = 7;
    deferredDepthAttachmentRef.layout = VK_IMAGE_LAYOUT_DEPTH_STENCIL_ATTACHMENT_OPTIMAL;

    return deferredDepthAttachmentRef;
  }

  VkAttachmentReference DeferredSubPartRenderer::getResolveAttachmentRef() {
    VkAttachmentReference resolveAttachmentRef{};
    resolveAttachmentRef.attachment = 8;
    resolveAttachmentRef.layout = VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL;

    return resolveAttachmentRef;
  }

  void DeferredSubPartRenderer::createDeferredResources(uint32_t imageCount) {
    VkFormat colorFormat = this->swapChainImageFormat;
    VkFormat depthFormat = this->findDepthFormat();

    auto msaaSamples = this->device->getMSAASamples();

    this->deferredColorImages.clear();
    for (uint32_t i = 0; i < imageCount; i++) {
      this->deferredColorImages.push_back(new NugieVulkan::Image(
        this->device, this->width, this->height, 1, msaaSamples, colorFormat,
        VK_IMAGE_TILING_OPTIMAL, VK_IMAGE_USAGE_COLOR_ATTACHMENT_BIT | VK_IMAGE_USAGE_TRANSIENT_ATTACHMENT_BIT,
        VK_MEMORY_PROPERTY_LAZILY_ALLOCATED_BIT, VK_IMAGE_ASPECT_COLOR_BIT
      ));
    }

    this->deferredDepthImages.clear();
    for (uint32_t i = 0; i < imageCount; i++) {
      this->deferredDepthImages.push_back(new NugieVulkan::Image(
        this->device, this->width, this->height, 1, msaaSamples, depthFormat, 
        VK_IMAGE_TILING_OPTIMAL, VK_IMAGE_USAGE_DEPTH_STENCIL_ATTACHMENT_BIT | VK_IMAGE_USAGE_TRANSIENT_ATTACHMENT_BIT,
        VK_MEMORY_PROPERTY_LAZILY_ALLOCATED_BIT, VK_IMAGE_ASPECT_DEPTH_BIT
      ));
    }
  }

  VkFormat DeferredSubPartRenderer::findDepthFormat() {
    return this->device->findSupportedFormat(
      {VK_FORMAT_D16_UNORM, VK_FORMAT_D32_SFLOAT, VK_FORMAT_D32_SFLOAT_S8_UINT, VK_FORMAT_D24_UNORM_S8_UINT},
      VK_IMAGE_TILING_OPTIMAL,
      VK_FORMAT_FEATURE_DEPTH_STENCIL_ATTACHMENT_BIT);
  }
  
} // namespace NugieApp
