#pragma once

#include "../../vulkan/image/image.hpp"
#include "../../vulkan/renderpass/renderpass.hpp"

#include <vulkan/vulkan.h>
#include <vector>
#include <memory>

namespace NugieApp {
  class TerrainSubPartRenderer {
    public:
      TerrainSubPartRenderer(NugieVulkan::Device* device, const std::vector<NugieVulkan::Image*> &swapChainImages, VkFormat swapChainImageFormat, 
        uint32_t imageCount, uint32_t width, uint32_t height);
      ~TerrainSubPartRenderer();

      std::vector<std::vector<VkImageView>> getAttachments();
      std::vector<VkAttachmentDescription> getAttachmentDescs();
      std::vector<VkAttachmentReference> getOutputAttachmentRefs();
      VkAttachmentReference getDepthAttachmentRef();
      VkAttachmentReference getResolveAttachmentRef();

      void recreateResources(const std::vector<NugieVulkan::Image*> &swapChainImages, 
        uint32_t width, uint32_t height);
      
    private:
      uint32_t width, height, imageCount;
      NugieVulkan::Device* device;

      std::vector<NugieVulkan::Image*> terrainColorImages;
      std::vector<NugieVulkan::Image*> terrainDepthImages;
      std::vector<NugieVulkan::Image*> swapChainImages;

      VkFormat swapChainImageFormat;
      VkFormat findDepthFormat();

      void createImages();
      void deleteImages();
  };
  
} // namespace NugieApp