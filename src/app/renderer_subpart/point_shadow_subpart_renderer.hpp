#pragma once

#include "../../vulkan/image/image.hpp"
#include "../../vulkan/texture/texture.hpp"
#include "../../vulkan/renderpass/renderpass.hpp"

#include <vulkan/vulkan.h>
#include <vector>
#include <memory>

namespace NugieApp {
  class PointShadowSubPartRenderer {
    public:
      PointShadowSubPartRenderer(NugieVulkan::Device* device, uint32_t width, uint32_t height, uint32_t pointLightNum = 1u);
      ~PointShadowSubPartRenderer();

      std::vector<VkDescriptorImageInfo> getDepthInfoResources();

      std::vector<std::vector<VkImageView>> getAttachments();
      std::vector<VkAttachmentDescription> getAttachmentDescs();
      VkAttachmentReference getDepthAttachmentRef();
      
    private:
      uint32_t width, height, pointLightNum;
      NugieVulkan::Device* device;

      std::vector<NugieVulkan::Image*> shadowDepthImages;
      std::vector<NugieVulkan::Texture*> shadowDepthTextures;

      VkFormat findDepthFormat();
      void createShadowResources();
  };
  
} // namespace NugieApp
