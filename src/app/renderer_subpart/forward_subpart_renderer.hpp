#pragma once

#include "../../vulkan/image/image.hpp"
#include "../../vulkan/texture/texture.hpp"
#include "../../vulkan/renderpass/renderpass.hpp"

#include <vulkan/vulkan.h>
#include <vector>
#include <memory>

namespace NugieApp {
  class ForwardSubPartRenderer {
    public:
      ForwardSubPartRenderer(NugieVulkan::Device* device, uint32_t width, uint32_t height);
      ~ForwardSubPartRenderer();

      std::vector<VkDescriptorImageInfo> getPositionInfoResources();
      std::vector<VkDescriptorImageInfo> getNormalInfoResources();
      std::vector<VkDescriptorImageInfo> getTextCoordInfoResources();
      std::vector<VkDescriptorImageInfo> getMaterialIndexInfoResources();

      std::vector<std::vector<VkImageView>> getAttachments();
      std::vector<VkAttachmentDescription> getAttachmentDescs();
      std::vector<VkAttachmentReference> getOutputAttachmentRefs();
      VkAttachmentReference getDepthAttachmentRef();

      void recreateResources(uint32_t width, uint32_t height);
      
    private:
      uint32_t width, height;
      NugieVulkan::Device* device;
      
      std::vector<NugieVulkan::Image*> forwardPositionImages;
      std::vector<NugieVulkan::Image*> forwardNormalImages;
      std::vector<NugieVulkan::Image*> forwardTextCoordImages;
      std::vector<NugieVulkan::Image*> forwardMaterialIndexImages;
      std::vector<NugieVulkan::Image*> forwardDepthImages;

      std::vector<NugieVulkan::Texture*> forwardPositionTextures;
      std::vector<NugieVulkan::Texture*> forwardNormalTextures;
      std::vector<NugieVulkan::Texture*> forwardTextCoordTextures;
      std::vector<NugieVulkan::Texture*> forwardMaterialIndexTextures;

      VkFormat findDepthFormat();
      VkFormat findColorFormat(const std::vector<VkFormat> &colorFormats);

      void createImages();
      void createTextures();
      void deleteImages();
  };
  
} // namespace NugieApp
