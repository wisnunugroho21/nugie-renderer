#pragma once

#include <vulkan/vulkan.h>
#include <stdexcept>

#include "texture.hpp"
#include "../../../object/buffer/buffer.hpp"
#include "../../../object/command/command_buffer.hpp"
#include "../../../object/image/image.hpp"
#include "../../../object/sampler/sampler.hpp"

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
