#include "texture.hpp"

#define STB_IMAGE_IMPLEMENTATION
#include "../../../libraries/stb_image/stb_image.h"

#include <vulkan/vulkan.h>
#include <stdexcept>
#include <cmath>

#include "../buffer/buffer.hpp"
#include "../command/command_buffer.hpp"

namespace NugieVulkan {
  Texture::Texture(Device* device, CommandBuffer* commandBuffer, const char* textureFileName, VkFilter filterMode, VkSamplerAddressMode addressMode, 
    VkBool32 anistropyEnable, VkBorderColor borderColor, VkCompareOp compareOp, VkSamplerMipmapMode mipmapMode) : device{device} 
  {
    this->createTextureImage(commandBuffer, textureFileName);
    this->createTextureSampler(filterMode, addressMode, anistropyEnable, borderColor, compareOp, mipmapMode);
    this->isImageCreateHere = true;
  }

  Texture::Texture(Device* device, Image* image, VkFilter filterMode, VkSamplerAddressMode addressMode, 
    VkBool32 anistropyEnable, VkBorderColor borderColor, VkCompareOp compareOp, VkSamplerMipmapMode mipmapMode) 
    : device{device}, image{image} 
  {
    this->createTextureSampler(filterMode, addressMode, anistropyEnable, borderColor, compareOp, mipmapMode);
    this->isImageCreateHere = false;
  }

  Texture::~Texture() {
    vkDestroySampler(this->device->getLogicalDevice(), this->sampler, nullptr);
    if (this->stagingBuffer != nullptr) delete this->stagingBuffer;
    if (this->image != nullptr && this->isImageCreateHere) delete this->image;
  }

  void Texture::createTextureImage(CommandBuffer* commandBuffer, const char* textureFileName) {
    int texWidth, texHeight, texChannels;
    stbi_uc* pixels = stbi_load(textureFileName, &texWidth, &texHeight, &texChannels, STBI_rgb_alpha);
    VkDeviceSize imageSize = texWidth * texHeight * 4;

    if (!pixels) {
      throw std::runtime_error("failed to load texture image!");
    }

    this->mipLevels = static_cast<uint32_t>(std::floor(std::log2(std::max(texWidth, texHeight)))) + 1;

    unsigned long pixelSize = 4;
    uint32_t pixelCount = texWidth * texHeight;

    this->stagingBuffer = new Buffer(
			this->device,
			pixelSize,
			pixelCount,
			VK_BUFFER_USAGE_TRANSFER_SRC_BIT,
			VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT | VK_MEMORY_PROPERTY_HOST_COHERENT_BIT
    );

    this->stagingBuffer->map();
    this->stagingBuffer->writeToBuffer(pixels);
    this->stagingBuffer->unmap();

    stbi_image_free(pixels);

    this->image = new Image(this->device, texWidth, texHeight, this->mipLevels, VK_SAMPLE_COUNT_1_BIT, VK_FORMAT_R8G8B8A8_SRGB, 
      VK_IMAGE_TILING_OPTIMAL, VK_IMAGE_USAGE_TRANSFER_SRC_BIT | VK_IMAGE_USAGE_TRANSFER_DST_BIT | VK_IMAGE_USAGE_SAMPLED_BIT, 
      VK_MEMORY_PROPERTY_DEVICE_LOCAL_BIT, VK_IMAGE_ASPECT_COLOR_BIT);

    this->image->transitionImageLayout(commandBuffer, VK_IMAGE_LAYOUT_UNDEFINED, VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL, 
      VK_PIPELINE_STAGE_TOP_OF_PIPE_BIT, VK_PIPELINE_STAGE_TRANSFER_BIT, 
      0, VK_ACCESS_TRANSFER_WRITE_BIT);
      
    this->stagingBuffer->copyBufferToImage(commandBuffer, this->image);
    // this->image->transitionImageLayout(VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL, VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL);
  }

  void Texture::createTextureSampler(VkFilter filterMode, VkSamplerAddressMode addressMode, VkBool32 anistropyEnable, 
    VkBorderColor borderColor, VkCompareOp compareOp, VkSamplerMipmapMode mipmapMode) 
  {
    VkSamplerCreateInfo samplerInfo{};
    samplerInfo.sType = VK_STRUCTURE_TYPE_SAMPLER_CREATE_INFO;
    samplerInfo.magFilter = filterMode;
    samplerInfo.minFilter = filterMode;

    samplerInfo.addressModeU = addressMode;
    samplerInfo.addressModeV = addressMode;
    samplerInfo.addressModeW = addressMode;

    samplerInfo.anisotropyEnable = anistropyEnable;
    samplerInfo.maxAnisotropy = this->device->getProperties().limits.maxSamplerAnisotropy;

    samplerInfo.borderColor = borderColor;
    samplerInfo.unnormalizedCoordinates = VK_FALSE;

    samplerInfo.compareEnable = compareOp == VK_COMPARE_OP_NEVER ? VK_FALSE : VK_TRUE;
    samplerInfo.compareOp = compareOp;

    samplerInfo.mipmapMode = mipmapMode;
    samplerInfo.minLod = 0.0f; // Optional
    samplerInfo.maxLod = static_cast<float>(this->mipLevels);
    samplerInfo.mipLodBias = 0.0f; // Optional

    if (vkCreateSampler(this->device->getLogicalDevice(), &samplerInfo, nullptr, &this->sampler) != VK_SUCCESS) {
      throw std::runtime_error("failed to create texture sampler!");
    }
  }

  VkDescriptorImageInfo Texture::getDescriptorInfo(VkImageLayout desiredImageLayout) const {
    VkDescriptorImageInfo imageInfo{};
    imageInfo.imageLayout = desiredImageLayout;
    imageInfo.imageView = this->image->getImageView();
    imageInfo.sampler = this->sampler;

    return imageInfo;
  }

  void Texture::generateMipmap(CommandBuffer* commandBuffer) {
    this->image->generateMipMap(commandBuffer);
    this->hasMipmapped = true;
  }
} // namespace NugieVulkan
