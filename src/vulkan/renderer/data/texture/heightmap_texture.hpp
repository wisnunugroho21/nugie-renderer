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
  class HeightMapTexture : public Texture {
    public:
      HeightMapTexture(NugieVulkan::Device* device, NugieVulkan::CommandBuffer* commandBuffer, const std::vector<float> &heightPoints);

    private:
      void createImage(NugieVulkan::CommandBuffer* commandBuffer, const std::vector<float> &heightPoints);
      void createSampler() override;
  };
} // namespace NugieApp
