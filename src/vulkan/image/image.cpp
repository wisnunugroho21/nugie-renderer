#include "image.hpp"

namespace NugieVulkan {
    Image::Image(Device *device, uint32_t width, uint32_t height, uint32_t mipLevels, VkSampleCountFlagBits numSamples,
                 VkFormat format, VkImageTiling tiling, VkImageUsageFlags usage, VmaMemoryUsage memoryUsage,
                 VmaAllocationCreateFlags memoryAllocFlag,
                 VkImageAspectFlags aspectFlags, uint32_t layerNum, VkImageViewType viewType)
            : device{device}, height{height}, width{width}, mipLevels{mipLevels}, format{format},
              aspectFlags{aspectFlags}, layerNum{layerNum} {
        this->createImage(numSamples, tiling, usage, memoryUsage, memoryAllocFlag, viewType);
        this->createImageView(viewType);

        this->isImageCreatedByUs = true;
    }

    Image::Image(Device *device, uint32_t width, uint32_t height, VkImage image, uint32_t mipLevels, VkFormat format,
                 VkImageAspectFlags aspectFlags, uint32_t layerNum, VkImageViewType viewType)
            : device{device}, height{height}, width{width}, mipLevels{mipLevels}, format{format},
              aspectFlags{aspectFlags}, layerNum{layerNum} {
        this->image = image;
        this->createImageView(viewType);

        this->isImageCreatedByUs = false;
    }

    Image::~Image() {
        vkDestroyImageView(this->device->getLogicalDevice(), this->imageView, nullptr);

        if (this->isImageCreatedByUs) {
            vmaDestroyImage(this->device->getMemoryAllocator(), this->image, this->memoryAllocation);
        }
    }

    void Image::createImage(VkSampleCountFlagBits numSamples, VkImageTiling tiling, VkImageUsageFlags usage,
                            VmaMemoryUsage memoryUsage, VmaAllocationCreateFlags memoryAllocFlag,
                            VkImageViewType viewType) {
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

        if (viewType == VK_IMAGE_VIEW_TYPE_CUBE) {
            imageInfo.flags = VK_IMAGE_CREATE_CUBE_COMPATIBLE_BIT;
        }

        VmaAllocationCreateInfo allocInfo = {};
        allocInfo.usage = memoryUsage;
        allocInfo.flags = memoryAllocFlag;

        if (vmaCreateImage(this->device->getMemoryAllocator(), &imageInfo, &allocInfo, &this->image,
                           &this->memoryAllocation, nullptr) != VK_SUCCESS) {
            throw std::runtime_error("failed to create image!");
        }
    }

    void Image::createImageView(VkImageViewType viewType) {
        VkImageViewCreateInfo viewInfo{};
        viewInfo.sType = VK_STRUCTURE_TYPE_IMAGE_VIEW_CREATE_INFO;
        viewInfo.image = this->image;
        viewInfo.format = this->format;
        viewInfo.viewType = viewType;
        viewInfo.components.r = VK_COMPONENT_SWIZZLE_R;
        viewInfo.components.g = VK_COMPONENT_SWIZZLE_G;
        viewInfo.components.b = VK_COMPONENT_SWIZZLE_B;
        viewInfo.components.a = VK_COMPONENT_SWIZZLE_A;
        viewInfo.subresourceRange.aspectMask = this->aspectFlags;
        viewInfo.subresourceRange.baseMipLevel = 0;
        viewInfo.subresourceRange.levelCount = this->mipLevels;
        viewInfo.subresourceRange.baseArrayLayer = 0;
        viewInfo.subresourceRange.layerCount = this->layerNum;

        if (vkCreateImageView(this->device->getLogicalDevice(), &viewInfo, nullptr, &this->imageView) != VK_SUCCESS) {
            throw std::runtime_error("failed to create texture image view!");
        }
    }

    void Image::transitionImageLayout(CommandBuffer *commandBuffer, VkImageLayout oldLayout, VkImageLayout newLayout,
                                      VkPipelineStageFlags srcStage, VkPipelineStageFlags dstStage,
                                      VkAccessFlags srcAccess, VkAccessFlags dstAccess, uint32_t srcQueueFamilyIndex,
                                      uint32_t dstQueueFamilyIndex) {
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

    void Image::transitionImageLayout(CommandBuffer *commandBuffer, const std::vector<Image *> &images,
                                      VkImageLayout oldLayout, VkImageLayout newLayout,
                                      VkPipelineStageFlags srcStage, VkPipelineStageFlags dstStage,
                                      VkAccessFlags srcAccess, VkAccessFlags dstAccess, uint32_t srcQueueFamilyIndex,
                                      uint32_t dstQueueFamilyIndex) {
        std::vector<VkImageMemoryBarrier> barriers;

        for (auto &&image: images) {
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

    void
    Image::copyBufferToImage(CommandBuffer *commandBuffer, Buffer *srcBuffer, uint32_t srcOffset, uint32_t dstMipLevel,
                             uint32_t dstLayer) {
        VkBufferImageCopy region{};
        region.bufferOffset = srcOffset;
        region.bufferRowLength = 0;
        region.bufferImageHeight = 0;

        region.imageSubresource.aspectMask = VK_IMAGE_ASPECT_COLOR_BIT;
        region.imageSubresource.mipLevel = dstMipLevel;
        region.imageSubresource.baseArrayLayer = dstLayer;
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

    void
    Image::copyImageToBuffer(CommandBuffer *commandBuffer, Buffer *destBuffer, uint32_t dstOffset, uint32_t srcMipLevel,
                             uint32_t srcLayer) {
        VkBufferImageCopy region{};
        region.bufferOffset = dstOffset;
        region.bufferRowLength = 0;
        region.bufferImageHeight = 0;

        region.imageSubresource.aspectMask = VK_IMAGE_ASPECT_COLOR_BIT;
        region.imageSubresource.mipLevel = srcMipLevel;
        region.imageSubresource.baseArrayLayer = srcLayer;
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

    void
    Image::copyImageFromOther(CommandBuffer *commandBuffer, Image *srcImage, uint32_t srcMipLevel, uint32_t srcLayer,
                              uint32_t dstMipLevel, uint32_t dstLayer) {
        VkImageBlit blitRegion{};

        blitRegion.srcOffsets[0].x = 0;
        blitRegion.srcOffsets[0].y = 0;
        blitRegion.srcOffsets[0].z = 0;

        blitRegion.srcOffsets[1].x = static_cast<int32_t >(srcImage->getWidth());
        blitRegion.srcOffsets[1].y = static_cast<int32_t >(srcImage->getHeight());
        blitRegion.srcOffsets[1].z = 1;

        blitRegion.dstOffsets[0].x = 0;
        blitRegion.dstOffsets[0].y = 0;
        blitRegion.dstOffsets[0].z = 0;

        blitRegion.dstOffsets[1].x = static_cast<int32_t >(this->width);
        blitRegion.dstOffsets[1].y = static_cast<int32_t >(this->height);
        blitRegion.dstOffsets[1].z = 1;

        blitRegion.srcSubresource.aspectMask = VK_IMAGE_ASPECT_COLOR_BIT;
        blitRegion.srcSubresource.baseArrayLayer = 0;
        blitRegion.srcSubresource.layerCount = 1;
        blitRegion.srcSubresource.mipLevel = 0;

        blitRegion.dstSubresource.aspectMask = VK_IMAGE_ASPECT_COLOR_BIT;
        blitRegion.dstSubresource.baseArrayLayer = 0;
        blitRegion.dstSubresource.layerCount = 1;
        blitRegion.dstSubresource.mipLevel = 0;

        vkCmdBlitImage(commandBuffer->getCommandBuffer(), srcImage->getImage(), VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL, this->image,
                       VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL, 1, &blitRegion, VK_FILTER_LINEAR);
    }

    void Image::copyImageToOther(CommandBuffer *commandBuffer, Image *dstImage, uint32_t srcMipLevel, uint32_t srcLayer,
                                 uint32_t dstMipLevel, uint32_t dstLayer) {
        VkImageBlit blitRegion{};

        blitRegion.srcOffsets[0].x = 0;
        blitRegion.srcOffsets[0].y = 0;
        blitRegion.srcOffsets[0].z = 0;

        blitRegion.srcOffsets[1].y = static_cast<int32_t >(this->height);
        blitRegion.srcOffsets[1].x = static_cast<int32_t >(this->width);
        blitRegion.srcOffsets[1].z = 1;

        blitRegion.dstOffsets[0].x = 0;
        blitRegion.dstOffsets[0].y = 0;
        blitRegion.dstOffsets[0].z = 0;

        blitRegion.dstOffsets[1].x = static_cast<int32_t >(dstImage->getWidth());
        blitRegion.dstOffsets[1].y = static_cast<int32_t >(dstImage->getHeight());
        blitRegion.dstOffsets[1].z = 1;

        blitRegion.srcSubresource.aspectMask = VK_IMAGE_ASPECT_COLOR_BIT;
        blitRegion.srcSubresource.baseArrayLayer = 0;
        blitRegion.srcSubresource.layerCount = 1;
        blitRegion.srcSubresource.mipLevel = 0;

        blitRegion.dstSubresource.aspectMask = VK_IMAGE_ASPECT_COLOR_BIT;
        blitRegion.dstSubresource.baseArrayLayer = 0;
        blitRegion.dstSubresource.layerCount = 1;
        blitRegion.dstSubresource.mipLevel = 0;

        vkCmdBlitImage(commandBuffer->getCommandBuffer(), this->image, VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL, dstImage->getImage(),
                       VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL, 1, &blitRegion, VK_FILTER_LINEAR);
    }

    void Image::generateMipMap(CommandBuffer *commandBuffer) {
        if (!this->isImageCreatedByUs) {
            throw std::runtime_error(
                    "cannot generate mipmap if the image is not created by this class => image directly assigned to this class via second constructor");
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

        int32_t mipWidth = static_cast<int32_t >(this->width);
        int32_t mipHeight = static_cast<int32_t >(this->height);

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
            blit.srcOffsets[0] = {0, 0, 0};
            blit.srcOffsets[1] = {mipWidth, mipHeight, 1};
            blit.srcSubresource.aspectMask = this->aspectFlags;
            blit.srcSubresource.mipLevel = i - 1;
            blit.srcSubresource.baseArrayLayer = 0;
            blit.srcSubresource.layerCount = this->layerNum;
            blit.dstOffsets[0] = {0, 0, 0};
            blit.dstOffsets[1] = {mipWidth > 1 ? mipWidth / 2 : 1, mipHeight > 1 ? mipHeight / 2 : 1, 1};
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
