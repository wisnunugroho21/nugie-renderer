#include "shadow_subpart_renderer.hpp"

#include <assert.h>
#include <array>

namespace NugieApp {
  ShadowSubPartRenderer::ShadowSubPartRenderer(NugieVulkan::Device* device, uint32_t width, uint32_t height, uint32_t lightNum)
    : device{device}, width{width}, height{height}
  {
    this->createShadowResources(lightNum);
  }

  ShadowSubPartRenderer::~ShadowSubPartRenderer() {
    for (auto &&shadowDepthPointTexture : this->shadowDepthPointTextures) {
      if (shadowDepthPointTexture != nullptr) delete shadowDepthPointTexture;
    }

    for (auto &&depthImage : this->shadowDepthPointImages) {
      if (depthImage != nullptr) delete depthImage;
    }
  }

  std::vector<VkDescriptorImageInfo> ShadowSubPartRenderer::getDepthPointInfoResources() {
    std::vector<VkDescriptorImageInfo> descInfos{};
    for (auto &&shadowDepthPointTexture : this->shadowDepthPointTextures) {
      descInfos.emplace_back(shadowDepthPointTexture->getDescriptorInfo(VK_IMAGE_LAYOUT_DEPTH_STENCIL_READ_ONLY_OPTIMAL));
    }

    return descInfos;
  }

  std::vector<std::vector<VkImageView>> ShadowSubPartRenderer::getAttachments() {
    std::vector<std::vector<VkImageView>> attachments;

    std::vector<VkImageView> shadowDepthPointAttachment;
    for (size_t i = 0; i < this->shadowDepthPointImages.size(); i++) {
      shadowDepthPointAttachment.emplace_back(this->shadowDepthPointImages[i]->getImageView());
    }

    attachments.emplace_back(shadowDepthPointAttachment);

    return attachments;
  }

  std::vector<VkAttachmentDescription> ShadowSubPartRenderer::getAttachmentDescs() {
    VkFormat depthFormat = this->findDepthFormat();
    auto msaaSamples = VK_SAMPLE_COUNT_1_BIT; // this->device->getMSAASamples();

    VkAttachmentDescription shadowDepthPointAttachment{};
    shadowDepthPointAttachment.format = depthFormat;
    shadowDepthPointAttachment.samples = msaaSamples;
    shadowDepthPointAttachment.loadOp = VK_ATTACHMENT_LOAD_OP_CLEAR;
    shadowDepthPointAttachment.storeOp = VK_ATTACHMENT_STORE_OP_STORE;
    shadowDepthPointAttachment.stencilLoadOp = VK_ATTACHMENT_LOAD_OP_DONT_CARE;
    shadowDepthPointAttachment.stencilStoreOp = VK_ATTACHMENT_STORE_OP_DONT_CARE;
    shadowDepthPointAttachment.initialLayout = VK_IMAGE_LAYOUT_UNDEFINED;
    shadowDepthPointAttachment.finalLayout = VK_IMAGE_LAYOUT_DEPTH_STENCIL_READ_ONLY_OPTIMAL;

    std::vector<VkAttachmentDescription> attachmentDescs;
    attachmentDescs.emplace_back(shadowDepthPointAttachment);

    return attachmentDescs;
  }

  VkAttachmentReference ShadowSubPartRenderer::getDepthAttachmentRef() {
    VkAttachmentReference shadowDepthPointAttachmentRef{};
    shadowDepthPointAttachmentRef.attachment = 0;
    shadowDepthPointAttachmentRef.layout = VK_IMAGE_LAYOUT_DEPTH_STENCIL_ATTACHMENT_OPTIMAL;

    return shadowDepthPointAttachmentRef;
  }

  void ShadowSubPartRenderer::createShadowResources(uint32_t lightNum = 1u) {
    VkFormat depthFormat = this->findDepthFormat();
    auto msaaSamples = VK_SAMPLE_COUNT_1_BIT; // this->device->getMSAASamples();

    this->shadowDepthPointImages.clear();
    this->shadowDepthPointTextures.clear();
    
    for (uint32_t i = 0; i < NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT * lightNum; i++) {
      auto image = new NugieVulkan::Image(
        this->device, this->width, this->height, 1, msaaSamples, depthFormat, 
        VK_IMAGE_TILING_OPTIMAL, VK_IMAGE_USAGE_DEPTH_STENCIL_ATTACHMENT_BIT | VK_IMAGE_USAGE_SAMPLED_BIT,
        VK_MEMORY_PROPERTY_DEVICE_LOCAL_BIT, VK_IMAGE_ASPECT_DEPTH_BIT, 6
      );
      
      this->shadowDepthPointImages.push_back(image);
      this->shadowDepthPointTextures.push_back(new NugieVulkan::Texture(this->device, image, VK_FILTER_LINEAR, 
        VK_SAMPLER_ADDRESS_MODE_CLAMP_TO_BORDER, VK_TRUE, VK_BORDER_COLOR_FLOAT_OPAQUE_WHITE, VK_COMPARE_OP_NEVER, 
        VK_SAMPLER_MIPMAP_MODE_LINEAR));
    }
  }

  VkFormat ShadowSubPartRenderer::findDepthFormat() {
    return this->device->findSupportedFormat(
      { VK_FORMAT_D16_UNORM, VK_FORMAT_D32_SFLOAT, VK_FORMAT_D32_SFLOAT_S8_UINT, VK_FORMAT_D24_UNORM_S8_UINT },
      VK_IMAGE_TILING_OPTIMAL,
      VK_FORMAT_FEATURE_DEPTH_STENCIL_ATTACHMENT_BIT);
  }
} // namespace NugieApp
