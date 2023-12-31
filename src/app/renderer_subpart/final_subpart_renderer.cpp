#include "final_subpart_renderer.hpp"

#include <assert.h>
#include <array>

namespace NugieApp {
  FinalSubPartRenderer::FinalSubPartRenderer(NugieVulkan::Device* device, const std::vector<NugieVulkan::Image*> &swapChainImages, VkFormat swapChainImageFormat, 
    uint32_t width, uint32_t height, uint32_t imageCount)
    : device{device}, swapChainImages{swapChainImages}, colorImageFormat{swapChainImageFormat}, width{width}, height{height}, imageCount{imageCount}
  {
    this->createImages();
  }

  FinalSubPartRenderer::~FinalSubPartRenderer() {
    this->deleteImages();
  }

  std::vector<std::vector<VkImageView>> FinalSubPartRenderer::getAttachments() {
    std::vector<std::vector<VkImageView>> attachments;

    std::vector<VkImageView> swapChainAttachment;
    for (size_t i = 0; i < this->swapChainImages.size(); i++) {
      swapChainAttachment.emplace_back(this->swapChainImages[i]->getImageView());
    }

    attachments.emplace_back(swapChainAttachment);

    std::vector<VkImageView> finalDepthAttachment;
    for (size_t i = 0; i < this->finalDepthImages.size(); i++) {
      finalDepthAttachment.emplace_back(this->finalDepthImages[i]->getImageView());
    }

    attachments.emplace_back(finalDepthAttachment);

    return attachments;
  }

  std::vector<VkAttachmentDescription> FinalSubPartRenderer::getAttachmentDescs() {
    VkFormat depthFormat = this->findDepthFormat();
    auto msaaSamples = VK_SAMPLE_COUNT_1_BIT; //  this->device->getMSAASamples();

    VkAttachmentDescription swapChainAttachment{};
    swapChainAttachment.format = this->colorImageFormat;
    swapChainAttachment.samples = msaaSamples;
    swapChainAttachment.loadOp = VK_ATTACHMENT_LOAD_OP_DONT_CARE;
    swapChainAttachment.storeOp = VK_ATTACHMENT_STORE_OP_STORE;
    swapChainAttachment.stencilLoadOp = VK_ATTACHMENT_LOAD_OP_DONT_CARE;
    swapChainAttachment.stencilStoreOp = VK_ATTACHMENT_STORE_OP_DONT_CARE;
    swapChainAttachment.initialLayout = VK_IMAGE_LAYOUT_UNDEFINED;
    swapChainAttachment.finalLayout = VK_IMAGE_LAYOUT_PRESENT_SRC_KHR;

    VkAttachmentDescription finalDepthAttachment{};
    finalDepthAttachment.format = depthFormat;
    finalDepthAttachment.samples = msaaSamples;
    finalDepthAttachment.loadOp = VK_ATTACHMENT_LOAD_OP_CLEAR;
    finalDepthAttachment.storeOp = VK_ATTACHMENT_STORE_OP_DONT_CARE;
    finalDepthAttachment.stencilLoadOp = VK_ATTACHMENT_LOAD_OP_DONT_CARE;
    finalDepthAttachment.stencilStoreOp = VK_ATTACHMENT_STORE_OP_DONT_CARE;
    finalDepthAttachment.initialLayout = VK_IMAGE_LAYOUT_UNDEFINED;
    finalDepthAttachment.finalLayout = VK_IMAGE_LAYOUT_DEPTH_STENCIL_ATTACHMENT_OPTIMAL;

    std::vector<VkAttachmentDescription> attachmentDescs;
    attachmentDescs.emplace_back(swapChainAttachment);
    attachmentDescs.emplace_back(finalDepthAttachment);

    return attachmentDescs;
  }

  std::vector<VkAttachmentReference> FinalSubPartRenderer::getOutputAttachmentRefs() {
    VkAttachmentReference swapChainAttachmentRef{};
    swapChainAttachmentRef.attachment = 0;
    swapChainAttachmentRef.layout = VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL;

    std::vector<VkAttachmentReference> outputAttachmentRefs;
    outputAttachmentRefs.emplace_back(swapChainAttachmentRef);

    return outputAttachmentRefs;
  }

  VkAttachmentReference FinalSubPartRenderer::getDepthAttachmentRef() {
    VkAttachmentReference finalDepthAttachmentRef{};
    finalDepthAttachmentRef.attachment = 1;
    finalDepthAttachmentRef.layout = VK_IMAGE_LAYOUT_DEPTH_STENCIL_ATTACHMENT_OPTIMAL;

    return finalDepthAttachmentRef;
  }

  void FinalSubPartRenderer::createImages() {
    VkFormat depthFormat = this->findDepthFormat();
    auto msaaSamples = VK_SAMPLE_COUNT_1_BIT; // this->device->getMSAASamples();

    this->finalDepthImages.clear();
    for (uint32_t i = 0; i < this->imageCount; i++) {
      this->finalDepthImages.push_back(new NugieVulkan::Image(
        this->device, this->width, this->height, 1, msaaSamples, depthFormat, 
        VK_IMAGE_TILING_OPTIMAL, VK_IMAGE_USAGE_DEPTH_STENCIL_ATTACHMENT_BIT, 
        VK_MEMORY_PROPERTY_DEVICE_LOCAL_BIT, VK_IMAGE_ASPECT_DEPTH_BIT
      ));
    }
  }

  void FinalSubPartRenderer::deleteImages() {
    for (auto &&depthImage : this->finalDepthImages) {
      if (depthImage != nullptr) delete depthImage;
    }
  }

  void FinalSubPartRenderer::recreateResources(uint32_t width, uint32_t height) {
    this->width = width;
    this->height = height;
    
    this->deleteImages();
    this->createImages();
  }

  VkFormat FinalSubPartRenderer::findDepthFormat() {
    return this->device->findSupportedFormat(
      { VK_FORMAT_D16_UNORM, VK_FORMAT_D32_SFLOAT, VK_FORMAT_D32_SFLOAT_S8_UINT, VK_FORMAT_D24_UNORM_S8_UINT },
      VK_IMAGE_TILING_OPTIMAL,
      VK_FORMAT_FEATURE_DEPTH_STENCIL_ATTACHMENT_BIT);
  }
} // namespace NugieApp
