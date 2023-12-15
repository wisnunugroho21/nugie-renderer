#include "image.hpp"

namespace NugieVulkan {
  Image::Image(Device* device, uint32_t width, uint32_t height, uint32_t mipLevels, VkSampleCountFlagBits numSamples, 
    VkFormat format, VkImageTiling tiling, VkImageUsageFlags usage, VkMemoryPropertyFlags memoryProperty, 
    VkImageAspectFlags aspectFlags, uint32_t layerNum) 
    : device{device}, height{height}, width{width}, mipLevels{mipLevels}, format{format}, aspectFlags{aspectFlags}, layerNum{layerNum} 
  {
    this->createImage(numSamples, tiling, usage, memoryProperty);
    this->createImageView();

    this->isImageCreatedByUs = true;
  }

  Image::Image(Device* device, uint32_t width, uint32_t height, uint32_t mipLevels, VkSampleCountFlagBits numSamples, 
    VkFormat format, VkImageTiling tiling, VkImageUsageFlags usage, 
    const std::vector<VkMemoryPropertyFlags> &memoryProperties, 
    VkImageAspectFlags aspectFlags, uint32_t layerNum) 
    : device{device}, height{height}, width{width}, mipLevels{mipLevels}, format{format}, aspectFlags{aspectFlags}, layerNum{layerNum}
  {
    this->createImage(numSamples, tiling, usage, memoryProperties);
    this->createImageView();

    this->isImageCreatedByUs = true;
  }

  Image::Image(Device* device, uint32_t width, uint32_t height, VkImage image, uint32_t mipLevels, VkFormat format, 
    VkImageAspectFlags aspectFlags, uint32_t layerNum) 
    : device{device},  height{ height }, width{ width }, mipLevels{mipLevels}, format{format}, aspectFlags{aspectFlags}, layerNum{layerNum} 
  {
    this->image = image;
    this->createImageView();

    this->isImageCreatedByUs = false;
  }

  Image::~Image() {
    vkDestroyImageView(this->device->getLogicalDevice(), this->imageView, nullptr);

    if (this->isImageCreatedByUs) {
      vkDestroyImage(this->device->getLogicalDevice(), this->image, nullptr);
      vkFreeMemory(this->device->getLogicalDevice(), this->imageMemory, nullptr);
    }
  }

  void Image::createImage(VkSampleCountFlagBits numSamples, VkImageTiling tiling, VkImageUsageFlags usage, 
    VkMemoryPropertyFlags memoryProperty) 
  {
    VkImageCreateInfo imageInfo{};
    imageInfo.sType = VK_STRUCTURE_TYPE_IMAGE_CREATE_INFO;
    imageInfo.imageType = VK_IMAGE_TYPE_2D;
    imageInfo.extent.width = this->width;
    imageInfo.extent.height = this->height;
    imageInfo.extent.depth = 1;
    imageInfo.mipLevels = this->mipLevels;
    imageInfo.arrayLayers = this->layerNum;
    imageInfo.format = this->format;
    imageInfo.tiling = tiling;
    imageInfo.initialLayout = VK_IMAGE_LAYOUT_UNDEFINED;
    imageInfo.usage = usage;
    imageInfo.samples = numSamples;
    imageInfo.sharingMode = VK_SHARING_MODE_EXCLUSIVE;

    if (vkCreateImage(this->device->getLogicalDevice(), &imageInfo, nullptr, &this->image) != VK_SUCCESS) {
      throw std::runtime_error("failed to create image!");
    }

    VkMemoryRequirements memRequirements;
    vkGetImageMemoryRequirements(this->device->getLogicalDevice(), this->image, &memRequirements);

    VkMemoryAllocateInfo allocInfo{};
    allocInfo.sType = VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO;
    allocInfo.allocationSize = memRequirements.size;
    allocInfo.memoryTypeIndex = this->device->findMemoryType(memRequirements.memoryTypeBits, memoryProperty);

    if (vkAllocateMemory(this->device->getLogicalDevice(), &allocInfo, nullptr, &this->imageMemory) != VK_SUCCESS) {
      throw std::runtime_error("failed to allocate image memory!");
    }

    if (vkBindImageMemory(this->device->getLogicalDevice(), this->image, this->imageMemory, 0) != VK_SUCCESS) {
      throw std::runtime_error("failed to bind image memory!");
    }
  }

  void Image::createImage(VkSampleCountFlagBits numSamples, VkImageTiling tiling, VkImageUsageFlags usage, 
    const std::vector<VkMemoryPropertyFlags> &memoryProperties) 
  {
    VkImageCreateInfo imageInfo{};
    imageInfo.sType = VK_STRUCTURE_TYPE_IMAGE_CREATE_INFO;
    imageInfo.imageType = VK_IMAGE_TYPE_2D;
    imageInfo.extent.width = this->width;
    imageInfo.extent.height = this->height;
    imageInfo.extent.depth = 1;
    imageInfo.mipLevels = this->mipLevels;
    imageInfo.arrayLayers = this->layerNum;
    imageInfo.format = this->format;
    imageInfo.tiling = tiling;
    imageInfo.initialLayout = VK_IMAGE_LAYOUT_UNDEFINED;
    imageInfo.usage = usage;
    imageInfo.samples = numSamples;
    imageInfo.sharingMode = VK_SHARING_MODE_EXCLUSIVE;

    if (vkCreateImage(this->device->getLogicalDevice(), &imageInfo, nullptr, &this->image) != VK_SUCCESS) {
      throw std::runtime_error("failed to create image!");
    }

    VkMemoryRequirements memRequirements;
    vkGetImageMemoryRequirements(this->device->getLogicalDevice(), this->image, &memRequirements);

    VkMemoryAllocateInfo allocInfo{};
    allocInfo.sType = VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO;
    allocInfo.allocationSize = memRequirements.size;
    allocInfo.memoryTypeIndex = this->device->findMemoryType(memRequirements.memoryTypeBits, memoryProperties, nullptr);

    if (vkAllocateMemory(this->device->getLogicalDevice(), &allocInfo, nullptr, &this->imageMemory) != VK_SUCCESS) {
      throw std::runtime_error("failed to allocate image memory!");
    }

    if (vkBindImageMemory(this->device->getLogicalDevice(), this->image, this->imageMemory, 0) != VK_SUCCESS) {
      throw std::runtime_error("failed to bind image memory!");
    }
  }

  void Image::createImageView() {
    VkImageViewCreateInfo viewInfo{};
    viewInfo.sType = VK_STRUCTURE_TYPE_IMAGE_VIEW_CREATE_INFO;
    viewInfo.image = this->image;
    viewInfo.format = this->format;
    viewInfo.components.r = VK_COMPONENT_SWIZZLE_R;
    viewInfo.components.g = VK_COMPONENT_SWIZZLE_G;
    viewInfo.components.b = VK_COMPONENT_SWIZZLE_B;
    viewInfo.components.a = VK_COMPONENT_SWIZZLE_A;
    viewInfo.subresourceRange.aspectMask = this->aspectFlags;
    viewInfo.subresourceRange.baseMipLevel = 0;
    viewInfo.subresourceRange.levelCount = this->mipLevels;
    viewInfo.subresourceRange.baseArrayLayer = 0;
    viewInfo.subresourceRange.layerCount = this->layerNum;

    if (this->layerNum == 1) {
      viewInfo.viewType = VK_IMAGE_VIEW_TYPE_2D;
    } else {
      viewInfo.viewType = VK_IMAGE_VIEW_TYPE_2D_ARRAY;
    }

    if (vkCreateImageView(this->device->getLogicalDevice(), &viewInfo, nullptr, &this->imageView) != VK_SUCCESS) {
        throw std::runtime_error("failed to create texture image view!");
    }
  }

  void Image::transitionImageLayout(CommandBuffer* commandBuffer, VkImageLayout oldLayout, VkImageLayout newLayout, VkPipelineStageFlags srcStage, VkPipelineStageFlags dstStage, 
    VkAccessFlags srcAccess, VkAccessFlags dstAccess, uint32_t srcQueueFamilyIndex, uint32_t dstQueueFamilyIndex) 
  {
    VkImageMemoryBarrier barrier{};
    barrier.sType = VK_STRUCTURE_TYPE_IMAGE_MEMORY_BARRIER;
    barrier.oldLayout = oldLayout;
    barrier.newLayout = newLayout;

    barrier.srcQueueFamilyIndex = srcQueueFamilyIndex;
    barrier.dstQueueFamilyIndex = dstQueueFamilyIndex;

    barrier.image = this->image;
    barrier.subresourceRange.aspectMask = this->aspectFlags;
    barrier.subresourceRange.baseMipLevel = 0;
    barrier.subresourceRange.levelCount = this->mipLevels;
    barrier.subresourceRange.baseArrayLayer = 0;
    barrier.subresourceRange.layerCount = this->layerNum;
    barrier.srcAccessMask = srcAccess;
    barrier.dstAccessMask = dstAccess;

    this->layout = newLayout;

    vkCmdPipelineBarrier(
      commandBuffer->getCommandBuffer(), 
      srcStage, 
      dstStage,
      0,
      0, nullptr,
      0, nullptr,
      1, 
      &barrier
    );
  }
  
  void Image::transitionImageLayout(CommandBuffer* commandBuffer, const std::vector<Image*> &images, VkImageLayout oldLayout, VkImageLayout newLayout, 
    VkPipelineStageFlags srcStage, VkPipelineStageFlags dstStage, VkAccessFlags srcAccess, VkAccessFlags dstAccess, uint32_t srcQueueFamilyIndex, 
    uint32_t dstQueueFamilyIndex) 
  {
    std::vector<VkImageMemoryBarrier> barriers;

    for (auto &&image : images) {
      VkImageMemoryBarrier barrier{};

      barrier.sType = VK_STRUCTURE_TYPE_IMAGE_MEMORY_BARRIER;
      barrier.oldLayout = oldLayout;
      barrier.newLayout = newLayout;

      barrier.srcQueueFamilyIndex = srcQueueFamilyIndex;
      barrier.dstQueueFamilyIndex = dstQueueFamilyIndex;

      barrier.image = image->getImage();
      barrier.subresourceRange.aspectMask = image->getAspectFlag();
      barrier.subresourceRange.baseMipLevel = 0;
      barrier.subresourceRange.levelCount = image->getMipLevels();
      barrier.subresourceRange.baseArrayLayer = 0;
      barrier.subresourceRange.layerCount = image->getLayerNum();
      barrier.srcAccessMask = srcAccess;
      barrier.dstAccessMask = dstAccess;

      image->layout = newLayout;
      barriers.emplace_back(barrier);
    }

    vkCmdPipelineBarrier(
      commandBuffer->getCommandBuffer(), 
      srcStage, 
      dstStage,
      0,
      0, nullptr,
      0, nullptr,
      static_cast<uint32_t>(barriers.size()), 
      barriers.data()
    );
  }

  void Image::copyBufferToImage(CommandBuffer* commandBuffer, Buffer* srcBuffer) {
    VkBufferImageCopy region{};
    region.bufferOffset = 0;
    region.bufferRowLength = 0;
    region.bufferImageHeight = 0;

    region.imageSubresource.aspectMask = VK_IMAGE_ASPECT_COLOR_BIT;
    region.imageSubresource.mipLevel = 0;
    region.imageSubresource.baseArrayLayer = 0;
    region.imageSubresource.layerCount = this->layerNum;

    region.imageOffset = {0, 0, 0};
    region.imageExtent = {this->width, this->height, 1};

    vkCmdCopyBufferToImage(
      commandBuffer->getCommandBuffer(),
      srcBuffer->getBuffer(),
      this->image,
      VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL,
      1,
      &region
    );
  }

  void Image::copyImageToBuffer(CommandBuffer* commandBuffer, Buffer* destBuffer) {
    VkBufferImageCopy region{};
    region.bufferOffset = 0;
    region.bufferRowLength = 0;
    region.bufferImageHeight = 0;

    region.imageSubresource.aspectMask = VK_IMAGE_ASPECT_COLOR_BIT;
    region.imageSubresource.mipLevel = 0;
    region.imageSubresource.baseArrayLayer = 0;
    region.imageSubresource.layerCount = this->layerNum;

    region.imageOffset = {0, 0, 0};
    region.imageExtent = {this->width, this->height, 1};

    vkCmdCopyImageToBuffer(
      commandBuffer->getCommandBuffer(),
      this->image,
      VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL,
      destBuffer->getBuffer(),
      1,
      &region
    );
  }

  void Image::copyImageFromOther(CommandBuffer* commandBuffer, Image* srcImage) {
    VkImageCopy copyInfo{};

    copyInfo.srcSubresource = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 0, this->layerNum};
		copyInfo.srcOffset      = {0, 0, 0};
		copyInfo.dstSubresource = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 0, this->layerNum};
		copyInfo.dstOffset      = {0, 0, 0};
		copyInfo.extent         = {this->width, this->height, 1};

    vkCmdCopyImage(commandBuffer->getCommandBuffer(), srcImage->getImage(), srcImage->getLayout(), this->image, this->layout, 1u, &copyInfo);
  }

  void Image::copyImageToOther(CommandBuffer* commandBuffer, Image* dstImage) {
    VkImageCopy copyInfo{};

    copyInfo.srcSubresource = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 0, this->layerNum};
		copyInfo.srcOffset      = {0, 0, 0};
		copyInfo.dstSubresource = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 0, this->layerNum};
		copyInfo.dstOffset      = {0, 0, 0};
		copyInfo.extent         = {this->width, this->height, 1};

    vkCmdCopyImage(commandBuffer->getCommandBuffer(), this->image, this->layout, dstImage->getImage(), dstImage->getLayout(), 1u, &copyInfo);
  }

  void Image::generateMipMap(CommandBuffer* commandBuffer) {
    if (!this->isImageCreatedByUs) {
      throw std::runtime_error("cannot generate mipmap if the image is not created by this class => image directly assigned to this class via second constructor");
    }

    // Check if image format supports linear blitting
    VkFormatProperties formatProperties;
    vkGetPhysicalDeviceFormatProperties(this->device->getPhysicalDevice(), this->format, &formatProperties);

    if (!(formatProperties.optimalTilingFeatures & VK_FORMAT_FEATURE_SAMPLED_IMAGE_FILTER_LINEAR_BIT)) {
      throw std::runtime_error("texture image format does not support linear blitting!");
    }

    VkImageMemoryBarrier barrier{};
    barrier.sType = VK_STRUCTURE_TYPE_IMAGE_MEMORY_BARRIER;
    barrier.image = this->image;
    barrier.srcQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
    barrier.dstQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
    barrier.subresourceRange.aspectMask = this->aspectFlags;
    barrier.subresourceRange.baseArrayLayer = 0;
    barrier.subresourceRange.layerCount = this->layerNum;
    barrier.subresourceRange.levelCount = 1;

    int32_t mipWidth = this->width;
    int32_t mipHeight = this->height;

    for (uint32_t i = 1; i < this->mipLevels; i++) {
      barrier.subresourceRange.baseMipLevel = i - 1;
      barrier.oldLayout = VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL;
      barrier.newLayout = VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL;
      barrier.srcAccessMask = VK_ACCESS_TRANSFER_WRITE_BIT;
      barrier.dstAccessMask = VK_ACCESS_TRANSFER_READ_BIT;

      vkCmdPipelineBarrier(
        commandBuffer->getCommandBuffer(),
        VK_PIPELINE_STAGE_TRANSFER_BIT, VK_PIPELINE_STAGE_TRANSFER_BIT, 0,
        0, nullptr,
        0, nullptr,
        1, 
        &barrier
      );

      VkImageBlit blit{};
      blit.srcOffsets[0] = { 0, 0, 0 };
      blit.srcOffsets[1] = { mipWidth, mipHeight, 1 };
      blit.srcSubresource.aspectMask = this->aspectFlags;
      blit.srcSubresource.mipLevel = i - 1;
      blit.srcSubresource.baseArrayLayer = 0;
      blit.srcSubresource.layerCount = this->layerNum;
      blit.dstOffsets[0] = { 0, 0, 0 };
      blit.dstOffsets[1] = { mipWidth > 1 ? mipWidth / 2 : 1, mipHeight > 1 ? mipHeight / 2 : 1, 1 };
      blit.dstSubresource.aspectMask = this->aspectFlags;
      blit.dstSubresource.mipLevel = i;
      blit.dstSubresource.baseArrayLayer = 0;
      blit.dstSubresource.layerCount = this->layerNum;

      vkCmdBlitImage(
        commandBuffer->getCommandBuffer(),
        this->image, 
        VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL,
        this->image, 
        VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL,
        1, 
        &blit,
        VK_FILTER_LINEAR
      );

      barrier.oldLayout = VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL;
      barrier.newLayout = VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL;
      barrier.srcAccessMask = VK_ACCESS_TRANSFER_READ_BIT;
      barrier.dstAccessMask = VK_ACCESS_SHADER_READ_BIT;

      vkCmdPipelineBarrier(
        commandBuffer->getCommandBuffer(),
        VK_PIPELINE_STAGE_TRANSFER_BIT, 
        VK_PIPELINE_STAGE_FRAGMENT_SHADER_BIT, 
        0,
        0, nullptr,
        0, nullptr,
        1, 
        &barrier
      );

      if (mipWidth > 1) mipWidth /= 2;
      if (mipHeight > 1) mipHeight /= 2;
    }

    barrier.subresourceRange.baseMipLevel = mipLevels - 1;
    barrier.oldLayout = VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL;
    barrier.newLayout = VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL;
    barrier.srcAccessMask = VK_ACCESS_TRANSFER_WRITE_BIT;
    barrier.dstAccessMask = VK_ACCESS_SHADER_READ_BIT;

    vkCmdPipelineBarrier(
      commandBuffer->getCommandBuffer(),
      VK_PIPELINE_STAGE_TRANSFER_BIT, 
      VK_PIPELINE_STAGE_FRAGMENT_SHADER_BIT, 0,
      0, nullptr,
      0, nullptr,
      1, &barrier);
  }

  VkDescriptorImageInfo Image::getDescriptorInfo(VkImageLayout desiredImageLayout) {
    VkDescriptorImageInfo imageInfo{};
    imageInfo.imageLayout = desiredImageLayout;
    imageInfo.imageView = this->imageView;

    return imageInfo;
  }
} // namespace NugieVulkan
