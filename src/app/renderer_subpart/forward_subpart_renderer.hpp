#pragma once

#include "../../vulkan/image/image.hpp"
#include "../../vulkan/renderpass/renderpass.hpp"

#include <vulkan/vulkan.h>
#include <vector>
#include <memory>

namespace NugieApp {
  class ForwardSubPartRenderer {
    public:
      ForwardSubPartRenderer(NugieVulkan::Device* device, uint32_t imageCount, uint32_t width, uint32_t height);
      ~ForwardSubPartRenderer();

      std::vector<VkDescriptorImageInfo> getPositionInfoResources();
      std::vector<VkDescriptorImageInfo> getNormalInfoResources();
      std::vector<VkDescriptorImageInfo> getColorInfoResources();
      std::vector<VkDescriptorImageInfo> getMaterialInfoResources();
      std::vector<VkDescriptorImageInfo> getShadowCoordInfoResources();

      std::vector<std::vector<VkImageView>> getAttachments();
      std::vector<VkAttachmentDescription> getAttachmentDescs();
      std::vector<VkAttachmentReference> getOutputAttachmentRefs();
      VkAttachmentReference getDepthAttachmentRef();
      
    private:
      uint32_t width, height;
      NugieVulkan::Device* device;
      
      std::vector<NugieVulkan::Image*> forwardPositionImages;
      std::vector<NugieVulkan::Image*> forwardNormalImages;
      std::vector<NugieVulkan::Image*> forwardColorImages;
      std::vector<NugieVulkan::Image*> forwardMaterialImages;
      std::vector<NugieVulkan::Image*> forwardShadowCoordImages;
      std::vector<NugieVulkan::Image*> forwardDepthImages;

      VkFormat findDepthFormat();
      VkFormat findColorFormat();

      void createForwardResources(uint32_t imageCount);
  };
  
} // namespace NugieApp
