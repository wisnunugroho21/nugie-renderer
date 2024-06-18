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
  class HeightMapTexture : public Texture {
    public:
      HeightMapTexture(NugieVulkan::Device* device, NugieVulkan::CommandBuffer* commandBuffer, const std::vector<float> &heightPoints);

    private:
      void createImage(NugieVulkan::CommandBuffer* commandBuffer, const std::vector<float> &heightPoints);
      void createSampler() override;
  };
} // namespace NugieApp
