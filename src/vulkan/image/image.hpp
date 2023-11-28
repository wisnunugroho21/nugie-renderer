#pragma once

#include <vulkan/vulkan.h>
#include <stdexcept>

#include "../buffer/buffer.hpp"
#include "../command/command_buffer.hpp"

namespace NugieVulkan
{
  class Buffer;

  class Image
  {
    public:
      Image(Device* device, uint32_t width, uint32_t height, uint32_t mipLevels, VkSampleCountFlagBits numSamples, 
        VkFormat format, VkImageTiling tiling, VkImageUsageFlags usage, VkMemoryPropertyFlags properties, 
        VkImageAspectFlags aspectFlags, uint32_t layerNum = 1);
      Image(Device* device, uint32_t width, uint32_t height, VkImage image, uint32_t mipLevels, VkFormat format, 
        VkImageAspectFlags aspectFlags, uint32_t layerNum = 1);
      ~Image();

      VkImage getImage() const { return this->image; }
      VkImageView getImageView() const { return this->imageView; }
      VkDeviceMemory getImageMemory() const { return this->imageMemory; }
      VkImageLayout getLayout() const { return this->layout; }
      
      VkImageAspectFlags getAspectFlag() const { return this->aspectFlags; }
      uint32_t getMipLevels() const { return this->mipLevels; }
      uint32_t getLayerNum() const { return this->layerNum; }

      uint32_t getWidth() { return this->width; }
      uint32_t getHeight() { return this->height; }

      VkDescriptorImageInfo getDescriptorInfo(VkImageLayout desiredImageLayout);
      
      void copyBufferToImage(CommandBuffer* commandBuffer, Buffer* srcBuffer);
      void copyImageToBuffer(CommandBuffer* commandBuffer, Buffer* destBuffer);
      void copyImageFromOther(CommandBuffer* commandBuffer, Image* srcImage);
      void copyImageToOther(CommandBuffer* commandBuffer, Image* dstImage);

      void generateMipMap(CommandBuffer* commandBuffer);

      void transitionImageLayout(CommandBuffer* commandBuffer, VkImageLayout oldLayout, VkImageLayout newLayout, VkPipelineStageFlags srcStage, VkPipelineStageFlags dstStage, 
        VkAccessFlags srcAccess, VkAccessFlags dstAccess, uint32_t srcQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED, uint32_t dstQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED);

      static void transitionImageLayout(CommandBuffer* commandBuffer, std::vector<Image*> images, VkImageLayout oldLayout, VkImageLayout newLayout, 
        VkPipelineStageFlags srcStage, VkPipelineStageFlags dstStage, VkAccessFlags srcAccess, VkAccessFlags dstAccess, 
        uint32_t srcQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED, uint32_t dstQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED);

    private:
      Device* device;

      VkImage image;
      VkImageView imageView;
      VkDeviceMemory imageMemory;
      VkFormat format;
      VkImageAspectFlags aspectFlags;
      VkImageLayout layout = VK_IMAGE_LAYOUT_UNDEFINED;
      
      uint32_t width, height, mipLevels, layerNum;
      bool isImageCreatedByUs = false;

      void createImage(VkSampleCountFlagBits numSamples, VkImageTiling tiling, VkImageUsageFlags usage, 
        VkMemoryPropertyFlags properties);
      void createImageView();
  };
  
  
} // namespace NugieVulkan
