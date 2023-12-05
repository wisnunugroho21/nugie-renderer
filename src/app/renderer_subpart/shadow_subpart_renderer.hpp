#pragma once

#include "../../vulkan/image/image.hpp"
#include "../../vulkan/texture/texture.hpp"
#include "../../vulkan/renderpass/renderpass.hpp"

#include <vulkan/vulkan.h>
#include <vector>
#include <memory>

namespace NugieApp {
  class ShadowSubPartRenderer {
    public:
      ShadowSubPartRenderer(NugieVulkan::Device* device, uint32_t width, uint32_t height, uint32_t lightNum = 1u);
      ~ShadowSubPartRenderer();

      std::vector<VkDescriptorImageInfo> getDepthPointInfoResources();

      std::vector<std::vector<VkImageView>> getAttachments();
      std::vector<VkAttachmentDescription> getAttachmentDescs();
      VkAttachmentReference getDepthAttachmentRef();
      
    private:
      uint32_t width, height;
      NugieVulkan::Device* device;

      std::vector<NugieVulkan::Image*> shadowDepthPointImages;
      std::vector<NugieVulkan::Texture*> shadowDepthPointTextures;

      VkFormat findDepthFormat();
      void createShadowResources(uint32_t layerNum);
  };
  
} // namespace NugieApp
