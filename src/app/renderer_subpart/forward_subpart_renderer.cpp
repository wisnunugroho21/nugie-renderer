#include "forward_subpart_renderer.hpp"

#include <assert.h>
#include <array>

namespace NugieApp {
  ForwardSubPartRenderer::ForwardSubPartRenderer(NugieVulkan::Device* device, VkFormat swapChainImageFormat, 
    uint32_t imageCount, uint32_t width, uint32_t height)
    : device{device}, swapChainImageFormat{swapChainImageFormat}, width{width}, height{height}
  {
    this->createForwardResources(imageCount);
  }

  ForwardSubPartRenderer::~ForwardSubPartRenderer() {
    for (auto &&positionImage : this->forwardPositionImages) {
      if (positionImage != nullptr) delete positionImage;
    }

    for (auto &&normalImage : this->forwardNormalImages) {
      if (normalImage != nullptr) delete normalImage;
    }

    for (auto &&forwardColorImage : this->forwardColorImages) {
      if (forwardColorImage != nullptr) delete forwardColorImage;
    }

    for (auto &&forwardMaterialImage : this->forwardMaterialImages) {
      if (forwardMaterialImage != nullptr) delete forwardMaterialImage;
    }

    for (auto &&forwardShadowCoordImage : this->forwardShadowCoordImages) {
      if (forwardShadowCoordImage != nullptr) delete forwardShadowCoordImage;
    }

    for (auto &&depthImage : this->forwardDepthImages) {
      if (depthImage != nullptr) delete depthImage;
    }
  }

  std::vector<VkDescriptorImageInfo> ForwardSubPartRenderer::getPositionInfoResources() {
    std::vector<VkDescriptorImageInfo> descInfos{};
    for (auto &&forwardPositionImage : this->forwardPositionImages) {
      descInfos.emplace_back(forwardPositionImage->getDescriptorInfo(VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL));
    }

    return descInfos;
  }

  std::vector<VkDescriptorImageInfo> ForwardSubPartRenderer::getNormalInfoResources() {
    std::vector<VkDescriptorImageInfo> descInfos{};
    for (auto &&forwardNormalImage : this->forwardNormalImages) {
      descInfos.emplace_back(forwardNormalImage->getDescriptorInfo(VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL));
    }

    return descInfos;
  }

  std::vector<VkDescriptorImageInfo> ForwardSubPartRenderer::getColorInfoResources() {
    std::vector<VkDescriptorImageInfo> descInfos{};
    for (auto &&forwardColorImage : this->forwardColorImages) {
      descInfos.emplace_back(forwardColorImage->getDescriptorInfo(VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL));
    }

    return descInfos;
  }

  std::vector<VkDescriptorImageInfo> ForwardSubPartRenderer::getMaterialInfoResources() {
    std::vector<VkDescriptorImageInfo> descInfos{};
    for (auto &&forwardMaterialImage : this->forwardMaterialImages) {
      descInfos.emplace_back(forwardMaterialImage->getDescriptorInfo(VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL));
    }

    return descInfos;
  }

  std::vector<VkDescriptorImageInfo> ForwardSubPartRenderer::getShadowCoordInfoResources() {
    std::vector<VkDescriptorImageInfo> descInfos{};
    for (auto &&forwardShadowCoordImage : this->forwardShadowCoordImages) {
      descInfos.emplace_back(forwardShadowCoordImage->getDescriptorInfo(VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL));
    }

    return descInfos;
  }

  std::vector<std::vector<VkImageView>> ForwardSubPartRenderer::getAttachments() {
    std::vector<std::vector<VkImageView>> attachments;

    std::vector<VkImageView> forwardPositionAttachment;
    for (size_t i = 0; i < this->forwardPositionImages.size(); i++) {
      forwardPositionAttachment.emplace_back(this->forwardPositionImages[i]->getImageView());
    }

    attachments.emplace_back(forwardPositionAttachment);

    std::vector<VkImageView> forwardNormalAttachment;
    for (size_t i = 0; i < this->forwardNormalImages.size(); i++) {
      forwardNormalAttachment.emplace_back(this->forwardNormalImages[i]->getImageView());
    }

    attachments.emplace_back(forwardNormalAttachment);

    std::vector<VkImageView> forwardColorAttachment;
    for (size_t i = 0; i < this->forwardColorImages.size(); i++) {
      forwardColorAttachment.emplace_back(this->forwardColorImages[i]->getImageView());
    }

    attachments.emplace_back(forwardColorAttachment);

    std::vector<VkImageView> forwardMaterialAttachment;
    for (size_t i = 0; i < this->forwardMaterialImages.size(); i++) {
      forwardMaterialAttachment.emplace_back(this->forwardMaterialImages[i]->getImageView());
    }

    attachments.emplace_back(forwardMaterialAttachment);

    std::vector<VkImageView> forwardShadowCoordAttachment;
    for (size_t i = 0; i < this->forwardShadowCoordImages.size(); i++) {
      forwardShadowCoordAttachment.emplace_back(this->forwardShadowCoordImages[i]->getImageView());
    }

    attachments.emplace_back(forwardShadowCoordAttachment);

    std::vector<VkImageView> forwardDepthAttachment;
    for (size_t i = 0; i < this->forwardDepthImages.size(); i++) {
      forwardDepthAttachment.emplace_back(this->forwardDepthImages[i]->getImageView());
    }

    attachments.emplace_back(forwardDepthAttachment);

    return attachments;
  }

  std::vector<VkAttachmentDescription> ForwardSubPartRenderer::getAttachmentDescs() {
    VkFormat colorFormat = VK_FORMAT_R32G32B32A32_SFLOAT;
    VkFormat depthFormat = this->findDepthFormat();

    auto msaaSamples = this->device->getMSAASamples();

    VkAttachmentDescription forwardPositionAttachment{};
    forwardPositionAttachment.format = colorFormat;
    forwardPositionAttachment.samples = msaaSamples;
    forwardPositionAttachment.loadOp = VK_ATTACHMENT_LOAD_OP_CLEAR;
    forwardPositionAttachment.storeOp = VK_ATTACHMENT_STORE_OP_DONT_CARE;
    forwardPositionAttachment.stencilStoreOp = VK_ATTACHMENT_STORE_OP_DONT_CARE;
    forwardPositionAttachment.stencilLoadOp = VK_ATTACHMENT_LOAD_OP_DONT_CARE;
    forwardPositionAttachment.initialLayout = VK_IMAGE_LAYOUT_UNDEFINED;
    forwardPositionAttachment.finalLayout = VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL;

    VkAttachmentDescription forwardNormalAttachment{};
    forwardNormalAttachment.format = colorFormat;
    forwardNormalAttachment.samples = msaaSamples;
    forwardNormalAttachment.loadOp = VK_ATTACHMENT_LOAD_OP_CLEAR;
    forwardNormalAttachment.storeOp = VK_ATTACHMENT_STORE_OP_DONT_CARE;
    forwardNormalAttachment.stencilStoreOp = VK_ATTACHMENT_STORE_OP_DONT_CARE;
    forwardNormalAttachment.stencilLoadOp = VK_ATTACHMENT_LOAD_OP_DONT_CARE;
    forwardNormalAttachment.initialLayout = VK_IMAGE_LAYOUT_UNDEFINED;
    forwardNormalAttachment.finalLayout = VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL;

    VkAttachmentDescription forwardColorAttachment{};
    forwardColorAttachment.format = colorFormat;
    forwardColorAttachment.samples = msaaSamples;
    forwardColorAttachment.loadOp = VK_ATTACHMENT_LOAD_OP_CLEAR;
    forwardColorAttachment.storeOp = VK_ATTACHMENT_STORE_OP_DONT_CARE;
    forwardColorAttachment.stencilStoreOp = VK_ATTACHMENT_STORE_OP_DONT_CARE;
    forwardColorAttachment.stencilLoadOp = VK_ATTACHMENT_LOAD_OP_DONT_CARE;
    forwardColorAttachment.initialLayout = VK_IMAGE_LAYOUT_UNDEFINED;
    forwardColorAttachment.finalLayout = VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL;

    VkAttachmentDescription forwardMaterialAttachment{};
    forwardMaterialAttachment.format = colorFormat;
    forwardMaterialAttachment.samples = msaaSamples;
    forwardMaterialAttachment.loadOp = VK_ATTACHMENT_LOAD_OP_CLEAR;
    forwardMaterialAttachment.storeOp = VK_ATTACHMENT_STORE_OP_DONT_CARE;
    forwardMaterialAttachment.stencilStoreOp = VK_ATTACHMENT_STORE_OP_DONT_CARE;
    forwardMaterialAttachment.stencilLoadOp = VK_ATTACHMENT_LOAD_OP_DONT_CARE;
    forwardMaterialAttachment.initialLayout = VK_IMAGE_LAYOUT_UNDEFINED;
    forwardMaterialAttachment.finalLayout = VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL;

    VkAttachmentDescription forwardShadowCoordAttachment{};
    forwardShadowCoordAttachment.format = colorFormat;
    forwardShadowCoordAttachment.samples = msaaSamples;
    forwardShadowCoordAttachment.loadOp = VK_ATTACHMENT_LOAD_OP_CLEAR;
    forwardShadowCoordAttachment.storeOp = VK_ATTACHMENT_STORE_OP_DONT_CARE;
    forwardShadowCoordAttachment.stencilStoreOp = VK_ATTACHMENT_STORE_OP_DONT_CARE;
    forwardShadowCoordAttachment.stencilLoadOp = VK_ATTACHMENT_LOAD_OP_DONT_CARE;
    forwardShadowCoordAttachment.initialLayout = VK_IMAGE_LAYOUT_UNDEFINED;
    forwardShadowCoordAttachment.finalLayout = VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL;

    VkAttachmentDescription forwardDepthAttachment{};
    forwardDepthAttachment.format = depthFormat;
    forwardDepthAttachment.samples = msaaSamples;
    forwardDepthAttachment.loadOp = VK_ATTACHMENT_LOAD_OP_CLEAR;
    forwardDepthAttachment.storeOp = VK_ATTACHMENT_STORE_OP_DONT_CARE;
    forwardDepthAttachment.stencilLoadOp = VK_ATTACHMENT_LOAD_OP_DONT_CARE;
    forwardDepthAttachment.stencilStoreOp = VK_ATTACHMENT_STORE_OP_DONT_CARE;
    forwardDepthAttachment.initialLayout = VK_IMAGE_LAYOUT_UNDEFINED;
    forwardDepthAttachment.finalLayout = VK_IMAGE_LAYOUT_DEPTH_STENCIL_ATTACHMENT_OPTIMAL;

    std::vector<VkAttachmentDescription> attachmentDescs;
    attachmentDescs.emplace_back(forwardPositionAttachment);
    attachmentDescs.emplace_back(forwardNormalAttachment);
    attachmentDescs.emplace_back(forwardColorAttachment);
    attachmentDescs.emplace_back(forwardMaterialAttachment);
    attachmentDescs.emplace_back(forwardShadowCoordAttachment);
    attachmentDescs.emplace_back(forwardDepthAttachment);

    return attachmentDescs;
  }

  std::vector<VkAttachmentReference> ForwardSubPartRenderer::getOutputAttachmentRefs() {
    VkAttachmentReference forwardPositionAttachmentRef{};
    forwardPositionAttachmentRef.attachment = 0;
    forwardPositionAttachmentRef.layout = VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL;

    VkAttachmentReference forwardNormalAttachmentRef{};
    forwardNormalAttachmentRef.attachment = 1;
    forwardNormalAttachmentRef.layout = VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL;

    VkAttachmentReference forwardColorAttachmentRef{};
    forwardColorAttachmentRef.attachment = 2;
    forwardColorAttachmentRef.layout = VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL;

    VkAttachmentReference forwardMaterialAttachmentRef{};
    forwardMaterialAttachmentRef.attachment = 3;
    forwardMaterialAttachmentRef.layout = VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL;

    VkAttachmentReference forwardShadowCoordAttachmentRef{};
    forwardShadowCoordAttachmentRef.attachment = 4;
    forwardShadowCoordAttachmentRef.layout = VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL;

    std::vector<VkAttachmentReference> outputAttachmentRefs;
    outputAttachmentRefs.emplace_back(forwardPositionAttachmentRef);
    outputAttachmentRefs.emplace_back(forwardNormalAttachmentRef);
    outputAttachmentRefs.emplace_back(forwardColorAttachmentRef);
    outputAttachmentRefs.emplace_back(forwardMaterialAttachmentRef);
    outputAttachmentRefs.emplace_back(forwardShadowCoordAttachmentRef);

    return outputAttachmentRefs;
  }

  VkAttachmentReference ForwardSubPartRenderer::getDepthAttachmentRef() {
    VkAttachmentReference forwardDepthAttachmentRef{};
    forwardDepthAttachmentRef.attachment = 5;
    forwardDepthAttachmentRef.layout = VK_IMAGE_LAYOUT_DEPTH_STENCIL_ATTACHMENT_OPTIMAL;

    return forwardDepthAttachmentRef;
  }

  void ForwardSubPartRenderer::createForwardResources(uint32_t imageCount) {
    VkFormat colorFormat = VK_FORMAT_R32G32B32A32_SFLOAT;
    VkFormat depthFormat = this->findDepthFormat();

    auto msaaSamples = this->device->getMSAASamples();

    this->forwardPositionImages.clear();
    for (uint32_t i = 0; i < imageCount; i++) {
      this->forwardPositionImages.push_back(new NugieVulkan::Image(
        this->device, this->width, this->height, 1, msaaSamples, colorFormat,
        VK_IMAGE_TILING_OPTIMAL, VK_IMAGE_USAGE_COLOR_ATTACHMENT_BIT | VK_IMAGE_USAGE_INPUT_ATTACHMENT_BIT | VK_IMAGE_USAGE_TRANSIENT_ATTACHMENT_BIT,
        VK_MEMORY_PROPERTY_DEVICE_LOCAL_BIT, VK_IMAGE_ASPECT_COLOR_BIT
      ));
    }

    this->forwardNormalImages.clear();
    for (uint32_t i = 0; i < imageCount; i++) {
      this->forwardNormalImages.push_back(new NugieVulkan::Image(
        this->device, this->width, this->height, 1, msaaSamples, colorFormat,
        VK_IMAGE_TILING_OPTIMAL, VK_IMAGE_USAGE_COLOR_ATTACHMENT_BIT | VK_IMAGE_USAGE_INPUT_ATTACHMENT_BIT | VK_IMAGE_USAGE_TRANSIENT_ATTACHMENT_BIT,
        VK_MEMORY_PROPERTY_DEVICE_LOCAL_BIT, VK_IMAGE_ASPECT_COLOR_BIT
      ));
    }

    this->forwardColorImages.clear();
    for (uint32_t i = 0; i < imageCount; i++) {
      this->forwardColorImages.push_back(new NugieVulkan::Image(
        this->device, this->width, this->height, 1, msaaSamples, colorFormat,
        VK_IMAGE_TILING_OPTIMAL, VK_IMAGE_USAGE_COLOR_ATTACHMENT_BIT | VK_IMAGE_USAGE_INPUT_ATTACHMENT_BIT | VK_IMAGE_USAGE_TRANSIENT_ATTACHMENT_BIT,
        VK_MEMORY_PROPERTY_DEVICE_LOCAL_BIT, VK_IMAGE_ASPECT_COLOR_BIT
      ));
    }

    this->forwardMaterialImages.clear();
    for (uint32_t i = 0; i < imageCount; i++) {
      this->forwardMaterialImages.push_back(new NugieVulkan::Image(
        this->device, this->width, this->height, 1, msaaSamples, colorFormat,
        VK_IMAGE_TILING_OPTIMAL, VK_IMAGE_USAGE_COLOR_ATTACHMENT_BIT | VK_IMAGE_USAGE_INPUT_ATTACHMENT_BIT | VK_IMAGE_USAGE_TRANSIENT_ATTACHMENT_BIT,
        VK_MEMORY_PROPERTY_DEVICE_LOCAL_BIT, VK_IMAGE_ASPECT_COLOR_BIT
      ));
    }

    this->forwardShadowCoordImages.clear();
    for (uint32_t i = 0; i < imageCount; i++) {
      this->forwardShadowCoordImages.push_back(new NugieVulkan::Image(
        this->device, this->width, this->height, 1, msaaSamples, colorFormat,
        VK_IMAGE_TILING_OPTIMAL, VK_IMAGE_USAGE_COLOR_ATTACHMENT_BIT | VK_IMAGE_USAGE_INPUT_ATTACHMENT_BIT | VK_IMAGE_USAGE_TRANSIENT_ATTACHMENT_BIT,
        VK_MEMORY_PROPERTY_DEVICE_LOCAL_BIT, VK_IMAGE_ASPECT_COLOR_BIT
      ));
    }

    this->forwardDepthImages.clear();
    for (uint32_t i = 0; i < imageCount; i++) {
      this->forwardDepthImages.push_back(new NugieVulkan::Image(
        this->device, this->width, this->height, 1, msaaSamples, depthFormat, 
        VK_IMAGE_TILING_OPTIMAL, VK_IMAGE_USAGE_DEPTH_STENCIL_ATTACHMENT_BIT | VK_IMAGE_USAGE_TRANSIENT_ATTACHMENT_BIT, 
        VK_MEMORY_PROPERTY_LAZILY_ALLOCATED_BIT, VK_IMAGE_ASPECT_DEPTH_BIT
      ));
    }
  }

  VkFormat ForwardSubPartRenderer::findDepthFormat() {
    return this->device->findSupportedFormat(
      {VK_FORMAT_D16_UNORM, VK_FORMAT_D32_SFLOAT, VK_FORMAT_D32_SFLOAT_S8_UINT, VK_FORMAT_D24_UNORM_S8_UINT},
      VK_IMAGE_TILING_OPTIMAL,
      VK_FORMAT_FEATURE_DEPTH_STENCIL_ATTACHMENT_BIT);
  }
} // namespace NugieApp
