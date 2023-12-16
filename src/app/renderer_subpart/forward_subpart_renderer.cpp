#include "forward_subpart_renderer.hpp"

#include <assert.h>
#include <array>

namespace NugieApp {
  ForwardSubPartRenderer::ForwardSubPartRenderer(NugieVulkan::Device* device, uint32_t imageCount, uint32_t width, uint32_t height)
    : device{device}, imageCount{imageCount}, width{width}, height{height}
  {
    this->createImages();
  }

  ForwardSubPartRenderer::~ForwardSubPartRenderer() {
    this->deleteImages();
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

  std::vector<VkDescriptorImageInfo> ForwardSubPartRenderer::getTextCoordInfoResources() {
    std::vector<VkDescriptorImageInfo> descInfos{};
    for (auto &&forwardTextCoordImage : this->forwardTextCoordImages) {
      descInfos.emplace_back(forwardTextCoordImage->getDescriptorInfo(VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL));
    }

    return descInfos;
  }

  std::vector<VkDescriptorImageInfo> ForwardSubPartRenderer::getMaterialIndexInfoResources() {
    std::vector<VkDescriptorImageInfo> descInfos{};
    for (auto &&forwardMaterialIndexImage : this->forwardMaterialIndexImages) {
      descInfos.emplace_back(forwardMaterialIndexImage->getDescriptorInfo(VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL));
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

    std::vector<VkImageView> forwardTextCoordAttachment;
    for (size_t i = 0; i < this->forwardTextCoordImages.size(); i++) {
      forwardTextCoordAttachment.emplace_back(this->forwardTextCoordImages[i]->getImageView());
    }

    attachments.emplace_back(forwardTextCoordAttachment);

    std::vector<VkImageView> forwardMaterialIndexAttachment;
    for (size_t i = 0; i < this->forwardMaterialIndexImages.size(); i++) {
      forwardMaterialIndexAttachment.emplace_back(this->forwardMaterialIndexImages[i]->getImageView());
    }

    attachments.emplace_back(forwardMaterialIndexAttachment);

    std::vector<VkImageView> forwardDepthAttachment;
    for (size_t i = 0; i < this->forwardDepthImages.size(); i++) {
      forwardDepthAttachment.emplace_back(this->forwardDepthImages[i]->getImageView());
    }

    attachments.emplace_back(forwardDepthAttachment);

    return attachments;
  }

  std::vector<VkAttachmentDescription> ForwardSubPartRenderer::getAttachmentDescs() {
    VkFormat depthFormat = this->findDepthFormat();
    auto msaaSamples = this->device->getMSAASamples();

    VkAttachmentDescription forwardPositionAttachment{};
    forwardPositionAttachment.format = this->findColorFormat({ VK_FORMAT_R16G16B16A16_SFLOAT, VK_FORMAT_R32G32B32A32_SFLOAT });
    forwardPositionAttachment.samples = msaaSamples;
    forwardPositionAttachment.loadOp = VK_ATTACHMENT_LOAD_OP_CLEAR;
    forwardPositionAttachment.storeOp = VK_ATTACHMENT_STORE_OP_DONT_CARE;
    forwardPositionAttachment.stencilStoreOp = VK_ATTACHMENT_STORE_OP_DONT_CARE;
    forwardPositionAttachment.stencilLoadOp = VK_ATTACHMENT_LOAD_OP_DONT_CARE;
    forwardPositionAttachment.initialLayout = VK_IMAGE_LAYOUT_UNDEFINED;
    forwardPositionAttachment.finalLayout = VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL;

    VkAttachmentDescription forwardNormalAttachment{};
    forwardNormalAttachment.format = this->findColorFormat({ VK_FORMAT_R16G16B16A16_SFLOAT, VK_FORMAT_R32G32B32A32_SFLOAT });
    forwardNormalAttachment.samples = msaaSamples;
    forwardNormalAttachment.loadOp = VK_ATTACHMENT_LOAD_OP_CLEAR;
    forwardNormalAttachment.storeOp = VK_ATTACHMENT_STORE_OP_DONT_CARE;
    forwardNormalAttachment.stencilStoreOp = VK_ATTACHMENT_STORE_OP_DONT_CARE;
    forwardNormalAttachment.stencilLoadOp = VK_ATTACHMENT_LOAD_OP_DONT_CARE;
    forwardNormalAttachment.initialLayout = VK_IMAGE_LAYOUT_UNDEFINED;
    forwardNormalAttachment.finalLayout = VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL;

    VkAttachmentDescription forwardTextCoordAttachment{};
    forwardTextCoordAttachment.format = this->findColorFormat({ VK_FORMAT_R8G8_UNORM, VK_FORMAT_R16G16_UNORM, VK_FORMAT_R32G32_SFLOAT });
    forwardTextCoordAttachment.samples = msaaSamples;
    forwardTextCoordAttachment.loadOp = VK_ATTACHMENT_LOAD_OP_CLEAR;
    forwardTextCoordAttachment.storeOp = VK_ATTACHMENT_STORE_OP_DONT_CARE;
    forwardTextCoordAttachment.stencilStoreOp = VK_ATTACHMENT_STORE_OP_DONT_CARE;
    forwardTextCoordAttachment.stencilLoadOp = VK_ATTACHMENT_LOAD_OP_DONT_CARE;
    forwardTextCoordAttachment.initialLayout = VK_IMAGE_LAYOUT_UNDEFINED;
    forwardTextCoordAttachment.finalLayout = VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL;

    VkAttachmentDescription forwardMaterialIndexAttachment{};
    forwardMaterialIndexAttachment.format = this->findColorFormat({ VK_FORMAT_R8_UINT, VK_FORMAT_R16_UINT, VK_FORMAT_R32_UINT });
    forwardMaterialIndexAttachment.samples = msaaSamples;
    forwardMaterialIndexAttachment.loadOp = VK_ATTACHMENT_LOAD_OP_CLEAR;
    forwardMaterialIndexAttachment.storeOp = VK_ATTACHMENT_STORE_OP_DONT_CARE;
    forwardMaterialIndexAttachment.stencilStoreOp = VK_ATTACHMENT_STORE_OP_DONT_CARE;
    forwardMaterialIndexAttachment.stencilLoadOp = VK_ATTACHMENT_LOAD_OP_DONT_CARE;
    forwardMaterialIndexAttachment.initialLayout = VK_IMAGE_LAYOUT_UNDEFINED;
    forwardMaterialIndexAttachment.finalLayout = VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL;

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
    attachmentDescs.emplace_back(forwardTextCoordAttachment);
    attachmentDescs.emplace_back(forwardMaterialIndexAttachment);
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

    VkAttachmentReference forwardTextCoordAttachmentRef{};
    forwardTextCoordAttachmentRef.attachment = 2;
    forwardTextCoordAttachmentRef.layout = VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL;

    VkAttachmentReference forwardMaterialIndexAttachmentRef{};
    forwardMaterialIndexAttachmentRef.attachment = 3;
    forwardMaterialIndexAttachmentRef.layout = VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL;

    std::vector<VkAttachmentReference> outputAttachmentRefs;
    outputAttachmentRefs.emplace_back(forwardPositionAttachmentRef);
    outputAttachmentRefs.emplace_back(forwardNormalAttachmentRef);
    outputAttachmentRefs.emplace_back(forwardTextCoordAttachmentRef);
    outputAttachmentRefs.emplace_back(forwardMaterialIndexAttachmentRef);

    return outputAttachmentRefs;
  }

  VkAttachmentReference ForwardSubPartRenderer::getDepthAttachmentRef() {
    VkAttachmentReference forwardDepthAttachmentRef{};
    forwardDepthAttachmentRef.attachment = 4;
    forwardDepthAttachmentRef.layout = VK_IMAGE_LAYOUT_DEPTH_STENCIL_ATTACHMENT_OPTIMAL;

    return forwardDepthAttachmentRef;
  }

  void ForwardSubPartRenderer::createImages() {
    VkFormat depthFormat = this->findDepthFormat();

    auto msaaSamples = this->device->getMSAASamples();

    this->forwardPositionImages.clear();
    for (uint32_t i = 0; i < this->imageCount; i++) {
      this->forwardPositionImages.push_back(new NugieVulkan::Image(
        this->device, this->width, this->height, 1, msaaSamples, this->findColorFormat({ VK_FORMAT_R16G16B16A16_SFLOAT, VK_FORMAT_R32G32B32A32_SFLOAT }),
        VK_IMAGE_TILING_OPTIMAL, VK_IMAGE_USAGE_COLOR_ATTACHMENT_BIT | VK_IMAGE_USAGE_INPUT_ATTACHMENT_BIT | VK_IMAGE_USAGE_TRANSIENT_ATTACHMENT_BIT,
        { VK_MEMORY_PROPERTY_LAZILY_ALLOCATED_BIT, VK_MEMORY_PROPERTY_DEVICE_LOCAL_BIT }, VK_IMAGE_ASPECT_COLOR_BIT
      ));
    }

    this->forwardNormalImages.clear();
    for (uint32_t i = 0; i < this->imageCount; i++) {
      this->forwardNormalImages.push_back(new NugieVulkan::Image(
        this->device, this->width, this->height, 1, msaaSamples, this->findColorFormat({ VK_FORMAT_R16G16B16A16_SFLOAT, VK_FORMAT_R32G32B32A32_SFLOAT }),
        VK_IMAGE_TILING_OPTIMAL, VK_IMAGE_USAGE_COLOR_ATTACHMENT_BIT | VK_IMAGE_USAGE_INPUT_ATTACHMENT_BIT | VK_IMAGE_USAGE_TRANSIENT_ATTACHMENT_BIT,
        { VK_MEMORY_PROPERTY_LAZILY_ALLOCATED_BIT, VK_MEMORY_PROPERTY_DEVICE_LOCAL_BIT }, VK_IMAGE_ASPECT_COLOR_BIT
      ));
    }

    this->forwardTextCoordImages.clear();
    for (uint32_t i = 0; i < this->imageCount; i++) {
      this->forwardTextCoordImages.push_back(new NugieVulkan::Image(
        this->device, this->width, this->height, 1, msaaSamples, this->findColorFormat({ VK_FORMAT_R8G8_UNORM, VK_FORMAT_R16G16_UNORM, VK_FORMAT_R32G32_SFLOAT }),
        VK_IMAGE_TILING_OPTIMAL, VK_IMAGE_USAGE_COLOR_ATTACHMENT_BIT | VK_IMAGE_USAGE_INPUT_ATTACHMENT_BIT | VK_IMAGE_USAGE_TRANSIENT_ATTACHMENT_BIT,
        { VK_MEMORY_PROPERTY_LAZILY_ALLOCATED_BIT, VK_MEMORY_PROPERTY_DEVICE_LOCAL_BIT }, VK_IMAGE_ASPECT_COLOR_BIT
      ));
    }

    this->forwardMaterialIndexImages.clear();
    for (uint32_t i = 0; i < this->imageCount; i++) {
      this->forwardMaterialIndexImages.push_back(new NugieVulkan::Image(
        this->device, this->width, this->height, 1, msaaSamples, this->findColorFormat({ VK_FORMAT_R8_UINT, VK_FORMAT_R16_UINT, VK_FORMAT_R32_UINT }),
        VK_IMAGE_TILING_OPTIMAL, VK_IMAGE_USAGE_COLOR_ATTACHMENT_BIT | VK_IMAGE_USAGE_INPUT_ATTACHMENT_BIT | VK_IMAGE_USAGE_TRANSIENT_ATTACHMENT_BIT,
        { VK_MEMORY_PROPERTY_LAZILY_ALLOCATED_BIT, VK_MEMORY_PROPERTY_DEVICE_LOCAL_BIT }, VK_IMAGE_ASPECT_COLOR_BIT
      ));
    }

    this->forwardDepthImages.clear();
    for (uint32_t i = 0; i < imageCount; i++) {
      this->forwardDepthImages.push_back(new NugieVulkan::Image(
        this->device, this->width, this->height, 1, msaaSamples, depthFormat, 
        VK_IMAGE_TILING_OPTIMAL, VK_IMAGE_USAGE_DEPTH_STENCIL_ATTACHMENT_BIT | VK_IMAGE_USAGE_TRANSIENT_ATTACHMENT_BIT, 
        { VK_MEMORY_PROPERTY_LAZILY_ALLOCATED_BIT, VK_MEMORY_PROPERTY_DEVICE_LOCAL_BIT }, VK_IMAGE_ASPECT_DEPTH_BIT
      ));
    }
  }

  void ForwardSubPartRenderer::deleteImages() {
    for (auto &&positionImage : this->forwardPositionImages) {
      if (positionImage != nullptr) delete positionImage;
    }

    for (auto &&normalImage : this->forwardNormalImages) {
      if (normalImage != nullptr) delete normalImage;
    }

    for (auto &&forwardTextCoordImage : this->forwardTextCoordImages) {
      if (forwardTextCoordImage != nullptr) delete forwardTextCoordImage;
    }

    for (auto &&forwardMaterialIndexImage : this->forwardMaterialIndexImages) {
      if (forwardMaterialIndexImage != nullptr) delete forwardMaterialIndexImage;
    }

    for (auto &&depthImage : this->forwardDepthImages) {
      if (depthImage != nullptr) delete depthImage;
    }
  }

  void ForwardSubPartRenderer::recreateResources(uint32_t width, uint32_t height) {
    this->width = width;
    this->height = height;
    
    this->deleteImages();
    this->createImages();
  }

  VkFormat ForwardSubPartRenderer::findColorFormat(const std::vector<VkFormat> &colorFormats) {
     return this->device->findSupportedFormat(
      colorFormats,
      VK_IMAGE_TILING_OPTIMAL,
      VK_FORMAT_FEATURE_COLOR_ATTACHMENT_BIT);
  }

  VkFormat ForwardSubPartRenderer::findDepthFormat() {
    return this->device->findSupportedFormat(
      { VK_FORMAT_D16_UNORM, VK_FORMAT_D32_SFLOAT, VK_FORMAT_D32_SFLOAT_S8_UINT, VK_FORMAT_D24_UNORM_S8_UINT },
      VK_IMAGE_TILING_OPTIMAL,
      VK_FORMAT_FEATURE_DEPTH_STENCIL_ATTACHMENT_BIT);
  }
} // namespace NugieApp
