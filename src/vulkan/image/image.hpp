#pragma once

#include <vulkan/vulkan.h>
#include <stdexcept>

#include "../buffer/buffer.hpp"
#include "../command/command_buffer.hpp"

namespace NugieVulkan {
    class Buffer;

    class Image {
    public:
        Image(Device *device, uint32_t width, uint32_t height, uint32_t mipLevels, VkSampleCountFlagBits numSamples,
              VkFormat format, VkImageTiling tiling, VkImageUsageFlags usage, VmaMemoryUsage memoryUsage,
              VmaAllocationCreateFlags memoryAllocFlag, VkImageAspectFlags aspectFlags, uint32_t layerNum = 1,
              VkImageViewType viewType = VK_IMAGE_VIEW_TYPE_2D);

        Image(Device *device, uint32_t width, uint32_t height, VkImage image, uint32_t mipLevels, VkFormat format,
              VkImageAspectFlags aspectFlags, uint32_t layerNum = 1, VkImageViewType viewType = VK_IMAGE_VIEW_TYPE_2D);

        ~Image();

        VkImage getImage() const { return this->image; }

        VkImageView getImageView() const { return this->imageView; }

        VmaAllocation getMemoryAllocation() const { return this->memoryAllocation; }

        VkImageLayout getLayout() const { return this->layout; }

        VkImageAspectFlags getAspectFlag() const { return this->aspectFlags; }

        uint32_t getMipLevels() const { return this->mipLevels; }

        uint32_t getLayerNum() const { return this->layerNum; }

        uint32_t getWidth() const { return this->width; }

        uint32_t getHeight() const { return this->height; }

        VkDescriptorImageInfo getDescriptorInfo(VkImageLayout desiredImageLayout);

        void copyBufferToImage(CommandBuffer *commandBuffer, Buffer *srcBuffer, uint32_t srcOffset = 0,
                               uint32_t dstMipLevel = 0, uint32_t dstLayer = 0);

        void copyImageToBuffer(CommandBuffer *commandBuffer, Buffer *destBuffer, uint32_t dstOffset = 0,
                               uint32_t srcMipLevel = 0, uint32_t srcLayer = 0);

        void copyImageFromOther(CommandBuffer *commandBuffer, Image *srcImage, uint32_t srcMipLevel = 0,
                                uint32_t srcLayer = 0, uint32_t dstMipLevel = 0, uint32_t dstLayer = 0);

        void
        copyImageToOther(CommandBuffer *commandBuffer, Image *dstImage, uint32_t srcMipLevel = 0, uint32_t srcLayer = 0,
                         uint32_t dstMipLevel = 0, uint32_t dstLayer = 0);

        void generateMipMap(CommandBuffer *commandBuffer);

        void transitionImageLayout(CommandBuffer *commandBuffer, VkImageLayout oldLayout, VkImageLayout newLayout,
                                   VkPipelineStageFlags srcStage, VkPipelineStageFlags dstStage,
                                   VkAccessFlags srcAccess, VkAccessFlags dstAccess,
                                   uint32_t srcQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED,
                                   uint32_t dstQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED);

        static void
        transitionImageLayout(CommandBuffer *commandBuffer, const std::vector<Image *> &images, VkImageLayout oldLayout,
                              VkImageLayout newLayout,
                              VkPipelineStageFlags srcStage, VkPipelineStageFlags dstStage, VkAccessFlags srcAccess,
                              VkAccessFlags dstAccess,
                              uint32_t srcQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED,
                              uint32_t dstQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED);

    private:
        Device *device = nullptr;

        VkImage image;
        VkImageView imageView;
        VkFormat format;
        VkImageAspectFlags aspectFlags;
        VkImageLayout layout = VK_IMAGE_LAYOUT_UNDEFINED;
        VmaAllocation memoryAllocation;

        uint32_t width, height, mipLevels, layerNum;
        bool isImageCreatedByUs = false;

        void createImage(VkSampleCountFlagBits numSamples, VkImageTiling tiling, VkImageUsageFlags usage,
                         VmaMemoryUsage memoryUsage, VmaAllocationCreateFlags memoryAllocFlag,
                         VkImageViewType viewType);

        void createImageView(VkImageViewType viewType);
    };


} // namespace NugieVulkan
