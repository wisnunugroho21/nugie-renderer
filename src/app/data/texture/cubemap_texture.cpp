#include "cubemap_texture.hpp"

#include "../../../../libraries/stb_image/stb_image.h"

#include <vulkan/vulkan.h>
#include <stdexcept>
#include <cmath>

namespace NugieApp {
  CubeMapTexture::CubeMapTexture(NugieVulkan::Device* device, NugieVulkan::CommandBuffer* commandBuffer,  std::string textureFileNames[6]) : Texture(device) {
    this->createImage(commandBuffer, textureFileNames);
    this->createSampler();
  }

  void CubeMapTexture::createImage(NugieVulkan::CommandBuffer* commandBuffer, std::string textureFileNames[6]) {
    int texWidth, texHeight, texChannels;
    stbi_load(textureFileNames[0].c_str(), &texWidth, &texHeight, &texChannels, STBI_rgb_alpha);

    VkDeviceSize pixelSize = 4;
    uint32_t pixelCount = texWidth * texHeight;
    uint32_t mipLevels = static_cast<uint32_t>(std::floor(std::log2(std::max(texWidth, texHeight)))) + 1;

    this->stagingBuffer = new NugieVulkan::Buffer(
			this->device,
			pixelSize,
			pixelCount * 6,
			VK_BUFFER_USAGE_TRANSFER_SRC_BIT,
			VMA_MEMORY_USAGE_AUTO,
			VMA_ALLOCATION_CREATE_HOST_ACCESS_SEQUENTIAL_WRITE_BIT | VMA_ALLOCATION_CREATE_MAPPED_BIT
    );

    this->stagingBuffer->map();

    VkDeviceSize totalLoadedPixelSize = 0;
    for (uint32_t i = 0; i < 6; i++) {
      stbi_uc* pixels = stbi_load(textureFileNames[i].c_str(), &texWidth, &texHeight, &texChannels, STBI_rgb_alpha);
      
      if (!pixels) {
        throw std::runtime_error("failed to load texture image!");
      }
      
      VkDeviceSize loadedPixelSize = pixelSize * pixelCount;

      this->stagingBuffer->writeToBuffer(pixels, loadedPixelSize, totalLoadedPixelSize);
      totalLoadedPixelSize += loadedPixelSize;

      stbi_image_free(pixels);
    }

    this->image = new NugieVulkan::Image(this->device, texWidth, texHeight, mipLevels, VK_SAMPLE_COUNT_1_BIT, VK_FORMAT_R8G8B8A8_SRGB, 
      VK_IMAGE_TILING_OPTIMAL, VK_IMAGE_USAGE_TRANSFER_SRC_BIT | VK_IMAGE_USAGE_TRANSFER_DST_BIT | VK_IMAGE_USAGE_SAMPLED_BIT, 
      VMA_MEMORY_USAGE_AUTO, VMA_ALLOCATION_CREATE_DEDICATED_MEMORY_BIT, VK_IMAGE_ASPECT_COLOR_BIT, 6u, VK_IMAGE_VIEW_TYPE_CUBE);

    this->image->transitionImageLayout(commandBuffer, VK_IMAGE_LAYOUT_UNDEFINED, VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL, 
      VK_PIPELINE_STAGE_TOP_OF_PIPE_BIT, VK_PIPELINE_STAGE_TRANSFER_BIT, 0, VK_ACCESS_TRANSFER_WRITE_BIT);
      
    this->stagingBuffer->copyBufferToImage(commandBuffer, this->image);    
  }

  void CubeMapTexture::createSampler() {
    this->sampler = new NugieVulkan::Sampler(this->device, this->image, VK_FILTER_LINEAR, VK_SAMPLER_ADDRESS_MODE_CLAMP_TO_EDGE, 
      VK_TRUE, VK_BORDER_COLOR_FLOAT_OPAQUE_WHITE, VK_COMPARE_OP_NEVER, VK_SAMPLER_MIPMAP_MODE_LINEAR);
  }
} // namespace NugieApp
