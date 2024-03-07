#pragma once

#include <vulkan/vulkan.h>
#include <stdexcept>

#include "../../../vulkan/buffer/buffer.hpp"
#include "../../../vulkan/command/command_buffer.hpp"
#include "../../../vulkan/image/image.hpp"
#include "../../../vulkan/sampler/sampler.hpp"

#include <memory>

namespace NugieApp
{
  class Texture{
    public:
      Texture(NugieVulkan::Device* device, NugieVulkan::CommandBuffer* commandBuffer, const char* textureFileName);
      
      ~Texture();
      
      bool hasBeenMipmapped() const { return this->hasMipmapped; }

      VkDescriptorImageInfo getDescriptorInfo(VkImageLayout desiredImageLayout = VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL) const;
      void generateMipmap(NugieVulkan::CommandBuffer* commandBuffer);

    protected:
      Texture(NugieVulkan::Device* device);

      NugieVulkan::Device* device = nullptr;
      NugieVulkan::Buffer* stagingBuffer = nullptr;
      NugieVulkan::Image* image = nullptr;
      NugieVulkan::Sampler* sampler = nullptr;

      bool hasMipmapped = false;

      virtual void createImage(NugieVulkan::CommandBuffer* commandBuffer, const char* textureFileName);
      virtual void createSampler();
  };
  
  
} // namespace NugieApp
