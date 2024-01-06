#pragma once

#include <vulkan/vulkan.h>
#include <stdexcept>

#include "../buffer/buffer.hpp"
#include "../command/command_buffer.hpp"
#include "../image/image.hpp"

#include <memory>

namespace NugieVulkan
{
  class Sampler{
    public:
      Sampler(Device* device, Image* image, VkFilter filterMode, VkSamplerAddressMode addressMode, 
        VkBool32 anistropyEnable, VkBorderColor borderColor, VkCompareOp compareOp, VkSamplerMipmapMode mipmapMode);
      
      ~Sampler();
      
      void setImage(Image* image) { this->image = image; }
      VkDescriptorImageInfo getDescriptorInfo(VkImageLayout desiredImageLayout = VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL) const;

    private:
      Device* device;
      Image* image;
      VkSampler sampler;

      void createSampler(VkFilter filterMode, VkSamplerAddressMode addressMode, VkBool32 anistropyEnable, VkBorderColor borderColor, VkCompareOp compareOp, VkSamplerMipmapMode mipmapMode);
  };
  
  
} // namespace NugieVulkan
