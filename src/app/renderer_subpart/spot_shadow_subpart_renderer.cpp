#include "spot_shadow_subpart_renderer.hpp"

#include <assert.h>
#include <array>

namespace NugieApp {
  SpotShadowSubPartRenderer::SpotShadowSubPartRenderer(NugieVulkan::Device* device, uint32_t width, uint32_t height, uint32_t spotLightNum)
    : device{device}, width{width}, height{height}, spotLightNum{spotLightNum}
  {
    this->createImages();
    this->createTextures();
  }

  SpotShadowSubPartRenderer::~SpotShadowSubPartRenderer() {
    for (auto &&shadowDepthTexture : this->shadowDepthTextures) {
      if (shadowDepthTexture != nullptr) delete shadowDepthTexture;
    }

    this->deleteImages();
  }

  std::vector<VkDescriptorImageInfo> SpotShadowSubPartRenderer::getDepthInfoResources() {
    std::vector<VkDescriptorImageInfo> descInfos{};
    for (auto &&shadowDepthTexture : this->shadowDepthTextures) {
      descInfos.emplace_back(shadowDepthTexture->getDescriptorInfo(VK_IMAGE_LAYOUT_DEPTH_STENCIL_READ_ONLY_OPTIMAL));
    }

    return descInfos;
  }

  std::vector<std::vector<VkImageView>> SpotShadowSubPartRenderer::getAttachments() {
    std::vector<std::vector<VkImageView>> attachments;

    std::vector<VkImageView> shadowDepthAttachment;
    for (size_t i = 0; i < this->shadowDepthImages.size(); i++) {
      shadowDepthAttachment.emplace_back(this->shadowDepthImages[i]->getImageView());
    }

    attachments.emplace_back(shadowDepthAttachment);

    return attachments;
  }

  std::vector<VkAttachmentDescription> SpotShadowSubPartRenderer::getAttachmentDescs() {
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

  VkAttachmentReference SpotShadowSubPartRenderer::getDepthAttachmentRef() {
    VkAttachmentReference shadowDepthAttachmentRef{};
    shadowDepthAttachmentRef.attachment = 0;
    shadowDepthAttachmentRef.layout = VK_IMAGE_LAYOUT_DEPTH_STENCIL_ATTACHMENT_OPTIMAL;

    return shadowDepthAttachmentRef;
  }

  void SpotShadowSubPartRenderer::createImages() {
    VkFormat depthFormat = this->findDepthFormat();
    auto msaaSamples = VK_SAMPLE_COUNT_1_BIT; // this->device->getMSAASamples();

    this->shadowDepthImages.clear();
    
    for (uint32_t i = 0; i < NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT * this->spotLightNum; i++) {
      this->shadowDepthImages.emplace_back(
        new NugieVulkan::Image(this->device, this->width, this->height, 1u, msaaSamples, depthFormat, 
        VK_IMAGE_TILING_OPTIMAL, VK_IMAGE_USAGE_DEPTH_STENCIL_ATTACHMENT_BIT | VK_IMAGE_USAGE_SAMPLED_BIT,
        VK_MEMORY_PROPERTY_DEVICE_LOCAL_BIT, VK_IMAGE_ASPECT_DEPTH_BIT)
      );
    }
  }

  void SpotShadowSubPartRenderer::createTextures() {
    for (auto &&shadowDepthImage : shadowDepthImages) {
      this->shadowDepthTextures.push_back(new NugieVulkan::Texture(this->device, shadowDepthImage, VK_FILTER_NEAREST,
        VK_SAMPLER_ADDRESS_MODE_CLAMP_TO_BORDER, VK_FALSE, VK_BORDER_COLOR_FLOAT_OPAQUE_WHITE, VK_COMPARE_OP_NEVER, 
        VK_SAMPLER_MIPMAP_MODE_LINEAR));
    }
  }

  void SpotShadowSubPartRenderer::deleteImages() {
    for (auto &&shadowDepthImage : this->shadowDepthImages) {
      if (shadowDepthImage != nullptr) delete shadowDepthImage;
    }
  }

  void SpotShadowSubPartRenderer::recreateResources(uint32_t width, uint32_t height) {
    this->width = width;
    this->height = height;
    
    this->deleteImages();
    this->createImages();

    for (size_t i = 0; i < this->shadowDepthImages.size(); i++) {
      this->shadowDepthTextures[i]->setImage(this->shadowDepthImages[i]);
    }
  }

  VkFormat SpotShadowSubPartRenderer::findDepthFormat() {
    return this->device->findSupportedFormat(
      { VK_FORMAT_D16_UNORM, VK_FORMAT_D32_SFLOAT, VK_FORMAT_D32_SFLOAT_S8_UINT, VK_FORMAT_D24_UNORM_S8_UINT },
      VK_IMAGE_TILING_OPTIMAL,
      VK_FORMAT_FEATURE_DEPTH_STENCIL_ATTACHMENT_BIT);
  }
} // namespace NugieApp
