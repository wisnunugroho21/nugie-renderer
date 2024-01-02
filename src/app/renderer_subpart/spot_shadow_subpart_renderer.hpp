#pragma once

#include "../../vulkan/image/image.hpp"
#include "../../vulkan/sampler/sampler.hpp"
#include "../../vulkan/renderpass/renderpass.hpp"

#include <vulkan/vulkan.h>
#include <vector>
#include <memory>

namespace NugieApp {
  class SpotShadowSubPartRenderer {
    public:
      SpotShadowSubPartRenderer(NugieVulkan::Device* device, uint32_t width, uint32_t height, uint32_t spotLightNum = 1u);
      ~SpotShadowSubPartRenderer();

      std::vector<VkDescriptorImageInfo> getDepthInfoResources();

      std::vector<std::vector<VkImageView>> getAttachments();
      std::vector<VkAttachmentDescription> getAttachmentDescs();
      VkAttachmentReference getDepthAttachmentRef();

      void recreateResources(uint32_t width, uint32_t height);
      
    private:
      uint32_t width, height, spotLightNum;
      NugieVulkan::Device* device;

      std::vector<NugieVulkan::Image*> shadowDepthImages;
      std::vector<NugieVulkan::Sampler*> shadowDepthSamplers;

      VkFormat findDepthFormat();

      void createImages();
      void createSamplers();

      void deleteImages();
  };
  
} // namespace NugieApp
