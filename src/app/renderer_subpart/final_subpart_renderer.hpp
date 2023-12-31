#pragma once

#include "../../vulkan/image/image.hpp"
#include "../../vulkan/texture/texture.hpp"
#include "../../vulkan/renderpass/renderpass.hpp"

#include <vulkan/vulkan.h>
#include <vector>
#include <memory>

namespace NugieApp {
  class FinalSubPartRenderer {
    public:
      FinalSubPartRenderer(NugieVulkan::Device* device, const std::vector<NugieVulkan::Image*> &swapChainImages, VkFormat swapChainImageFormat, 
        uint32_t width, uint32_t height, uint32_t imageCount);
      ~FinalSubPartRenderer();

      std::vector<std::vector<VkImageView>> getAttachments();
      std::vector<VkAttachmentDescription> getAttachmentDescs();
      std::vector<VkAttachmentReference> getOutputAttachmentRefs();
      VkAttachmentReference getDepthAttachmentRef();

      void recreateResources(uint32_t width, uint32_t height);
      
    private:
      uint32_t width, height, imageCount;
      NugieVulkan::Device* device;
      
      std::vector<NugieVulkan::Image*> swapChainImages;
      std::vector<NugieVulkan::Image*> finalDepthImages;

      VkFormat colorImageFormat;
      VkFormat findDepthFormat();

      void createImages();
      void deleteImages();
  };
  
} // namespace NugieApp
