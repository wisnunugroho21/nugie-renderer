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
      Texture(Device* device, CommandBuffer* commandBuffer, const char* textureFileName);
      ~Texture();

      VkDescriptorImageInfo getDescriptorInfo();

    private:
      Device* device;
      Image* image;

      VkSampler sampler;
      uint32_t mipLevels;

      void createTextureImage(CommandBuffer* commandBuffer, const char* textureFileName);
      void createTextureSampler();
  };
  
  
} // namespace NugieVulkan
