#pragma once

#include <vulkan/vulkan.h>
#include <stdexcept>

#include "../buffer/buffer.hpp"
#include "../command/command_buffer.hpp"
#include "../image/image.hpp"

#include <memory>

namespace NugieVulkan
{
  class Texture{
    public:
      Texture(Device* device, CommandBuffer* commandBuffer, const char* textureFileName, VkFilter filterMode, VkSamplerAddressMode addressMode, 
        VkBool32 anistropyEnable, VkBorderColor borderColor, VkCompareOp compareOp, VkSamplerMipmapMode mipmapMode);
      Texture(Device* device, Image* image, VkFilter filterMode, VkSamplerAddressMode addressMode, 
        VkBool32 anistropyEnable, VkBorderColor borderColor, VkCompareOp compareOp, VkSamplerMipmapMode mipmapMode);
      
      ~Texture();

      VkDescriptorImageInfo getDescriptorInfo(VkImageLayout desiredImageLayout = VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL);

    private:
      Device* device;
      Image* image;
      Buffer* stagingBuffer;

      VkSampler sampler;
      uint32_t mipLevels;

      void createTextureImage(CommandBuffer* commandBuffer, const char* textureFileName);
      void createTextureSampler(VkFilter filterMode, VkSamplerAddressMode addressMode, VkBool32 anistropyEnable, VkBorderColor borderColor, VkCompareOp compareOp, VkSamplerMipmapMode mipmapMode);
  };
  
  
} // namespace NugieVulkan
