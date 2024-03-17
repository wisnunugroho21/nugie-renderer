#pragma once

#include <vulkan/vulkan.h>
#include <stdexcept>

#include "texture.hpp"
#include "../../../vulkan/buffer/buffer.hpp"
#include "../../../vulkan/command/command_buffer.hpp"
#include "../../../vulkan/image/image.hpp"
#include "../../../vulkan/sampler/sampler.hpp"

#include <memory>

namespace NugieApp
{
  class CubeMapTexture : public Texture {
    public:
      CubeMapTexture(NugieVulkan::Device* device, NugieVulkan::CommandBuffer* commandBuffer,  std::string textureFileNames[6]);

    private:
      void createImage(NugieVulkan::CommandBuffer* commandBuffer,  std::string textureFileNames[6]);
      void createSampler() override;
  };
} // namespace NugieApp
