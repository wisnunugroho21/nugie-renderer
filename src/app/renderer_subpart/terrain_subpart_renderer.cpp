#include "terrain_subpart_renderer.hpp"

#include <assert.h>
#include <array>

namespace NugieApp {
  TerrainSubPartRenderer::TerrainSubPartRenderer(NugieVulkan::Device* device, const std::vector<NugieVulkan::Image*> &swapChainImages, VkFormat swapChainImageFormat, uint32_t imageCount, uint32_t width, uint32_t height) 
    : device{device}, swapChainImages{swapChainImages}, swapChainImageFormat{swapChainImageFormat}, imageCount{imageCount}, width{width}, height{height}
  {
    this->createImages();
  }

  TerrainSubPartRenderer::~TerrainSubPartRenderer() {
    this->deleteImages();
  }

  std::vector<std::vector<VkImageView>> TerrainSubPartRenderer::getAttachments() {
    std::vector<std::vector<VkImageView>> attachments;

    std::vector<VkImageView> terrainColorAttachment;
    for (size_t i = 0; i < this->terrainColorImages.size(); i++) {
      terrainColorAttachment.emplace_back(this->terrainColorImages[i]->getImageView());
    }

    attachments.emplace_back(terrainColorAttachment);

    std::vector<VkImageView> terrainDepthAttachment;
    for (size_t i = 0; i < this->terrainDepthImages.size(); i++) {
      terrainDepthAttachment.emplace_back(this->terrainDepthImages[i]->getImageView());
    }

    attachments.emplace_back(terrainDepthAttachment);

    std::vector<VkImageView> swapChainAttachment;
    for (size_t i = 0; i < this->swapChainImages.size(); i++) {
      swapChainAttachment.emplace_back(this->swapChainImages[i]->getImageView());
    }

    attachments.emplace_back(swapChainAttachment);

    return attachments;
  }

  std::vector<VkAttachmentDescription> TerrainSubPartRenderer::getAttachmentDescs() {
    VkFormat colorFormat = this->swapChainImageFormat;
    VkFormat depthFormat = this->findDepthFormat();

    auto msaaSamples = this->device->getMSAASamples();

    VkAttachmentDescription terrainColorAttachment{};
    terrainColorAttachment.format = colorFormat;
    terrainColorAttachment.samples = msaaSamples;
    terrainColorAttachment.loadOp = VK_ATTACHMENT_LOAD_OP_CLEAR;
    terrainColorAttachment.storeOp = VK_ATTACHMENT_STORE_OP_DONT_CARE;
    terrainColorAttachment.stencilStoreOp = VK_ATTACHMENT_STORE_OP_DONT_CARE;
    terrainColorAttachment.stencilLoadOp = VK_ATTACHMENT_LOAD_OP_DONT_CARE;
    terrainColorAttachment.initialLayout = VK_IMAGE_LAYOUT_UNDEFINED;
    terrainColorAttachment.finalLayout = VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL;

    VkAttachmentDescription terrainDepthAttachment{};
    terrainDepthAttachment.format = depthFormat;
    terrainDepthAttachment.samples = msaaSamples;
    terrainDepthAttachment.loadOp = VK_ATTACHMENT_LOAD_OP_CLEAR;
    terrainDepthAttachment.storeOp = VK_ATTACHMENT_STORE_OP_DONT_CARE;
    terrainDepthAttachment.stencilLoadOp = VK_ATTACHMENT_LOAD_OP_DONT_CARE;
    terrainDepthAttachment.stencilStoreOp = VK_ATTACHMENT_STORE_OP_DONT_CARE;
    terrainDepthAttachment.initialLayout = VK_IMAGE_LAYOUT_UNDEFINED;
    terrainDepthAttachment.finalLayout = VK_IMAGE_LAYOUT_DEPTH_STENCIL_ATTACHMENT_OPTIMAL;

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
    attachmentDescs.emplace_back(terrainColorAttachment);
    attachmentDescs.emplace_back(terrainDepthAttachment);
    attachmentDescs.emplace_back(resolveAttachment);

    return attachmentDescs;
  }

  std::vector<VkAttachmentReference> TerrainSubPartRenderer::getOutputAttachmentRefs() {
    VkAttachmentReference terrainColorAttachmentRef{};
    terrainColorAttachmentRef.attachment = 0;
    terrainColorAttachmentRef.layout = VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL;

    std::vector<VkAttachmentReference> outputAttachmentRefs;
    outputAttachmentRefs.emplace_back(terrainColorAttachmentRef);

    return outputAttachmentRefs;
  }

  VkAttachmentReference TerrainSubPartRenderer::getDepthAttachmentRef() {
    VkAttachmentReference terrainDepthAttachmentRef{};
    terrainDepthAttachmentRef.attachment = 1;
    terrainDepthAttachmentRef.layout = VK_IMAGE_LAYOUT_DEPTH_STENCIL_ATTACHMENT_OPTIMAL;

    return terrainDepthAttachmentRef;
  }

  VkAttachmentReference TerrainSubPartRenderer::getResolveAttachmentRef() {
    VkAttachmentReference resolveAttachmentRef{};
    resolveAttachmentRef.attachment = 2;
    resolveAttachmentRef.layout = VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL;

    return resolveAttachmentRef;
  }

  void TerrainSubPartRenderer::createImages() {
    VkFormat colorFormat = this->swapChainImageFormat;
    VkFormat depthFormat = this->findDepthFormat();

    auto msaaSamples = this->device->getMSAASamples();

    this->terrainColorImages.clear();
    for (uint32_t i = 0; i < this->imageCount; i++) {
      this->terrainColorImages.push_back(new NugieVulkan::Image(
        this->device, this->width, this->height, 1, msaaSamples, colorFormat,
        VK_IMAGE_TILING_OPTIMAL, VK_IMAGE_USAGE_COLOR_ATTACHMENT_BIT | VK_IMAGE_USAGE_TRANSIENT_ATTACHMENT_BIT,
        { VK_MEMORY_PROPERTY_LAZILY_ALLOCATED_BIT, VK_MEMORY_PROPERTY_DEVICE_LOCAL_BIT }, VK_IMAGE_ASPECT_COLOR_BIT
      ));
    }

    this->terrainDepthImages.clear();
    for (uint32_t i = 0; i < this->imageCount; i++) {
      this->terrainDepthImages.push_back(new NugieVulkan::Image(
        this->device, this->width, this->height, 1, msaaSamples, depthFormat, 
        VK_IMAGE_TILING_OPTIMAL, VK_IMAGE_USAGE_DEPTH_STENCIL_ATTACHMENT_BIT | VK_IMAGE_USAGE_TRANSIENT_ATTACHMENT_BIT,
        { VK_MEMORY_PROPERTY_LAZILY_ALLOCATED_BIT, VK_MEMORY_PROPERTY_DEVICE_LOCAL_BIT }, VK_IMAGE_ASPECT_DEPTH_BIT
      ));
    }
  }

  void TerrainSubPartRenderer::deleteImages() {
    for (auto &&colorImage : this->terrainColorImages) {
      if (colorImage != nullptr) delete colorImage;
    }

    for (auto &&depthImage : this->terrainDepthImages) {
      if (depthImage != nullptr) delete depthImage;
    }
  }

  void TerrainSubPartRenderer::recreateResources(const std::vector<NugieVulkan::Image*> &swapChainImages, 
    uint32_t width, uint32_t height) 
  {
    this->swapChainImages = swapChainImages;
    this->width = width;
    this->height = height;
    
    this->deleteImages();
    this->createImages();
  }

  VkFormat TerrainSubPartRenderer::findDepthFormat() {
    return this->device->findSupportedFormat(
      { VK_FORMAT_D16_UNORM, VK_FORMAT_D32_SFLOAT, VK_FORMAT_D32_SFLOAT_S8_UINT, VK_FORMAT_D24_UNORM_S8_UINT },
      VK_IMAGE_TILING_OPTIMAL,
      VK_FORMAT_FEATURE_DEPTH_STENCIL_ATTACHMENT_BIT);
  }
  
} // namespace NugieApp
