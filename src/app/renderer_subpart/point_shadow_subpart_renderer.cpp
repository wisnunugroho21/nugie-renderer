#include "point_shadow_subpart_renderer.hpp"

#include <assert.h>
#include <array>

namespace NugieApp {
  PointShadowSubPartRenderer::PointShadowSubPartRenderer(NugieVulkan::Device* device, uint32_t width, uint32_t height, uint32_t pointLightNum, uint32_t spotLightNum)
    : device{device}, width{width}, height{height}, pointLightNum{pointLightNum}, spotLightNum{spotLightNum}
  {
    this->createShadowResources();
  }

  PointShadowSubPartRenderer::~PointShadowSubPartRenderer() {
    for (auto &&pointShadowDepthTexture : this->pointShadowDepthTextures) {
      if (pointShadowDepthTexture != nullptr) delete pointShadowDepthTexture;
    }

    for (auto &&pointShadowDepthImage : this->pointShadowDepthImages) {
      if (pointShadowDepthImage != nullptr) delete pointShadowDepthImage;
    }

    for (auto &&spotShadowDepthTexture : this->spotShadowDepthTextures) {
      if (spotShadowDepthTexture != nullptr) delete spotShadowDepthTexture;
    }

    for (auto &&spotShadowDepthImage : this->spotShadowDepthImages) {
      if (spotShadowDepthImage != nullptr) delete spotShadowDepthImage;
    }
  }

  std::vector<VkDescriptorImageInfo> PointShadowSubPartRenderer::getPointDepthInfoResources() {
    std::vector<VkDescriptorImageInfo> descInfos{};
    for (auto &&pointShadowDepthTexture : this->pointShadowDepthTextures) {
      descInfos.emplace_back(pointShadowDepthTexture->getDescriptorInfo(VK_IMAGE_LAYOUT_DEPTH_STENCIL_READ_ONLY_OPTIMAL));
    }

    return descInfos;
  }

  std::vector<VkDescriptorImageInfo> PointShadowSubPartRenderer::getSpotDepthInfoResources() {
    std::vector<VkDescriptorImageInfo> descInfos{};
    for (auto &&spotShadowDepthTexture : this->spotShadowDepthTextures) {
      descInfos.emplace_back(spotShadowDepthTexture->getDescriptorInfo(VK_IMAGE_LAYOUT_DEPTH_STENCIL_READ_ONLY_OPTIMAL));
    }

    return descInfos;
  }

  std::vector<std::vector<VkImageView>> PointShadowSubPartRenderer::getAttachments() {
    std::vector<std::vector<VkImageView>> attachments;

    std::vector<VkImageView> shadowDepthAttachment;
    for (size_t i = 0; i < this->pointShadowDepthImages.size(); i++) {
      shadowDepthAttachment.emplace_back(this->pointShadowDepthImages[i]->getImageView());
    }

    for (size_t i = 0; i < this->spotShadowDepthImages.size(); i++) {
      shadowDepthAttachment.emplace_back(this->spotShadowDepthImages[i]->getImageView());
    }

    attachments.emplace_back(shadowDepthAttachment);

    return attachments;
  }

  std::vector<VkAttachmentDescription> PointShadowSubPartRenderer::getAttachmentDescs() {
    VkFormat depthFormat = this->findDepthFormat();
    auto msaaSamples = VK_SAMPLE_COUNT_1_BIT; // this->device->getMSAASamples();

    VkAttachmentDescription shadowDepthAttachment{};
    shadowDepthAttachment.format = depthFormat;
    shadowDepthAttachment.samples = msaaSamples;
    shadowDepthAttachment.loadOp = VK_ATTACHMENT_LOAD_OP_CLEAR;
    shadowDepthAttachment.storeOp = VK_ATTACHMENT_STORE_OP_STORE;
    shadowDepthAttachment.stencilLoadOp = VK_ATTACHMENT_LOAD_OP_DONT_CARE;
    shadowDepthAttachment.stencilStoreOp = VK_ATTACHMENT_STORE_OP_DONT_CARE;
    shadowDepthAttachment.initialLayout = VK_IMAGE_LAYOUT_UNDEFINED;
    shadowDepthAttachment.finalLayout = VK_IMAGE_LAYOUT_DEPTH_STENCIL_READ_ONLY_OPTIMAL;

    std::vector<VkAttachmentDescription> attachmentDescs;
    attachmentDescs.emplace_back(shadowDepthAttachment);

    return attachmentDescs;
  }

  VkAttachmentReference PointShadowSubPartRenderer::getDepthAttachmentRef() {
    VkAttachmentReference shadowDepthAttachmentRef{};
    shadowDepthAttachmentRef.attachment = 0;
    shadowDepthAttachmentRef.layout = VK_IMAGE_LAYOUT_DEPTH_STENCIL_ATTACHMENT_OPTIMAL;

    return shadowDepthAttachmentRef;
  }

  void PointShadowSubPartRenderer::createShadowResources() {
    VkFormat depthFormat = this->findDepthFormat();
    auto msaaSamples = VK_SAMPLE_COUNT_1_BIT; // this->device->getMSAASamples();

    this->pointShadowDepthImages.clear();
    this->pointShadowDepthTextures.clear();
    
    for (uint32_t i = 0; i < NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT * this->pointLightNum; i++) {
      auto image = new NugieVulkan::Image(
        this->device, this->width, this->height, 1, msaaSamples, depthFormat, 
        VK_IMAGE_TILING_OPTIMAL, VK_IMAGE_USAGE_DEPTH_STENCIL_ATTACHMENT_BIT | VK_IMAGE_USAGE_SAMPLED_BIT,
        VK_MEMORY_PROPERTY_DEVICE_LOCAL_BIT, VK_IMAGE_ASPECT_DEPTH_BIT, 6
      );
      
      this->pointShadowDepthImages.push_back(image);
      this->pointShadowDepthTextures.push_back(new NugieVulkan::Texture(this->device, image, VK_FILTER_LINEAR, 
        VK_SAMPLER_ADDRESS_MODE_CLAMP_TO_BORDER, VK_TRUE, VK_BORDER_COLOR_FLOAT_OPAQUE_WHITE, VK_COMPARE_OP_NEVER, 
        VK_SAMPLER_MIPMAP_MODE_LINEAR));
    }

    this->spotShadowDepthImages.clear();
    this->spotShadowDepthTextures.clear();
    
    for (uint32_t i = 0; i < NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT * this->spotLightNum; i++) {
      auto image = new NugieVulkan::Image(
        this->device, this->width, this->height, 1, msaaSamples, depthFormat, 
        VK_IMAGE_TILING_OPTIMAL, VK_IMAGE_USAGE_DEPTH_STENCIL_ATTACHMENT_BIT | VK_IMAGE_USAGE_SAMPLED_BIT,
        VK_MEMORY_PROPERTY_DEVICE_LOCAL_BIT, VK_IMAGE_ASPECT_DEPTH_BIT
      );
      
      this->spotShadowDepthImages.push_back(image);
      this->spotShadowDepthTextures.push_back(new NugieVulkan::Texture(this->device, image, VK_FILTER_LINEAR, 
        VK_SAMPLER_ADDRESS_MODE_CLAMP_TO_BORDER, VK_TRUE, VK_BORDER_COLOR_FLOAT_OPAQUE_WHITE, VK_COMPARE_OP_NEVER, 
        VK_SAMPLER_MIPMAP_MODE_LINEAR));
    }
  }

  VkFormat PointShadowSubPartRenderer::findDepthFormat() {
    return this->device->findSupportedFormat(
      { VK_FORMAT_D16_UNORM, VK_FORMAT_D32_SFLOAT, VK_FORMAT_D32_SFLOAT_S8_UINT, VK_FORMAT_D24_UNORM_S8_UINT },
      VK_IMAGE_TILING_OPTIMAL,
      VK_FORMAT_FEATURE_DEPTH_STENCIL_ATTACHMENT_BIT);
  }
} // namespace NugieApp
