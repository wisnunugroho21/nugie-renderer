#pragma once

#include "../../vulkan/image/image.hpp"
#include "../../vulkan/texture/texture.hpp"
#include "../../vulkan/renderpass/renderpass.hpp"

#include <vulkan/vulkan.h>
#include <vector>
#include <memory>

namespace NugieApp {
  class SpotShadowSubPartRenderer {
    public:
      SpotShadowSubPartRenderer(NugieVulkan::Device* device, uint32_t imageCount, uint32_t width, uint32_t height, uint32_t spotLightNum = 1u);
      ~SpotShadowSubPartRenderer();

      std::vector<VkDescriptorImageInfo> getDepthInfoResources();

      std::vector<std::vector<VkImageView>> getAttachments();
      std::vector<VkAttachmentDescription> getAttachmentDescs();
      VkAttachmentReference getDepthAttachmentRef();

      void recreateResources(uint32_t width, uint32_t height);
      
    private:
      uint32_t width, height, imageCount, spotLightNum;
      NugieVulkan::Device* device;

      std::vector<NugieVulkan::Image*> shadowDepthImages;
      std::vector<NugieVulkan::Texture*> shadowDepthTextures;

      VkFormat findDepthFormat();

      void createImages();
      void createTextures();

      void deleteImages();
  };
  
} // namespace NugieApp
