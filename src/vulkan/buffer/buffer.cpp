/*
 * Encapsulates a vulkan buffer
 *
 * Initially based off VulkanBuffer by Sascha Willems -
 * https://github.com/SaschaWillems/Vulkan/blob/master/base/VulkanBuffer.h
 */

#include "buffer.hpp"

// std
#include <cassert>
#include <cstring>

namespace NugieVulkan {
    /**
     * Returns the minimum instance size required to be compatible with devices minOffsetAlignment
     *
     * @param instanceSize The size of an instance
     * @param minOffsetAlignment The minimum required alignment, in bytes, for the offset member (eg
     * minUniformBufferOffsetAlignment)
     *
     * @return VkResult of the buffer mapping call
     */
    VkDeviceSize Buffer::getAlignment(VkDeviceSize instanceSize, VkDeviceSize minOffsetAlignment) {
        if (minOffsetAlignment > 0) {
            return (instanceSize + minOffsetAlignment - 1) & ~(minOffsetAlignment - 1);
        }
        return instanceSize;
    }

    Buffer::Buffer(
            Device *device,
            VkDeviceSize instanceSize,
            uint32_t instanceCount,
            VkBufferUsageFlags usageFlags,
            VmaMemoryUsage memoryUsage,
            VmaAllocationCreateFlags memoryAllocFlag,
            VkDeviceSize minOffsetAlignment
    )
            : device{device},
              instanceSize{instanceSize},
              instanceCount{instanceCount},
              usageFlags{usageFlags} {
        this->alignmentSize = this->getAlignment(instanceSize, minOffsetAlignment);
        this->bufferSize = alignmentSize * instanceCount;

        this->createBuffer(this->bufferSize, usageFlags, memoryUsage, memoryAllocFlag);
    }

    Buffer::Buffer(
            Device *device,
            VkDeviceSize size,
            VkBufferUsageFlags usageFlags,
            VmaMemoryUsage memoryUsage,
            VmaAllocationCreateFlags memoryAllocFlag,
            VkDeviceSize minOffsetAlignment
    )
            : device{device},
              usageFlags{usageFlags} {
        this->bufferSize = size;
        this->createBuffer(size, usageFlags, memoryUsage, memoryAllocFlag);
    }

    Buffer::~Buffer() {
        this->unmap();
        vmaDestroyBuffer(this->device->getMemoryAllocator(), this->buffer, this->memoryAllocation);
    }

    /**
     * Map a memory range of this buffer. If successful, mapped points to the specified buffer range.
     *
     * @param size (Optional) Size of the memory range to map. Pass VK_WHOLE_SIZE to map the complete
     * buffer range.
     * @param offset (Optional) Byte offset from beginning
     *
     * @return VkResult of the buffer mapping call
     */
    VkResult Buffer::map(VkDeviceSize size, VkDeviceSize offset) {
        assert(this->buffer && this->memoryAllocation && "Called map on buffer before create");
        return vmaMapMemory(this->device->getMemoryAllocator(), this->memoryAllocation, &this->mapped);
    }

    /**
     * Unmap a mapped memory range
     *
     * @note Does not return a result as vkUnmapMemory can't fail
     */
    void Buffer::unmap() {
        if (this->mapped) {
            vmaUnmapMemory(this->device->getMemoryAllocator(), this->memoryAllocation);
            this->mapped = nullptr;
        }
    }

    /**
     * Copies the specified data to the mapped buffer. Default value writes whole buffer range
     *
     * @param data Pointer to the data to copy
     * @param size (Optional) Size of the data to copy. Pass VK_WHOLE_SIZE to flush the complete buffer
     * range.
     * @param offset (Optional) Byte offset from beginning of mapped region
     *
     */
    void Buffer::writeToBuffer(void *data, VkDeviceSize size, VkDeviceSize offset) {
        assert(this->mapped && "Cannot copy to unmapped buffer");

        if (size == VK_WHOLE_SIZE) {
            memcpy(this->mapped, data, this->bufferSize);
        } else {
            char *memOffset = (char *) this->mapped;
            memOffset += offset;
            memcpy(memOffset, data, size);
        }
    }

    /**
     * Copies the specified data from the mapped buffer. Default value writes whole buffer range
     *
     * @param data Pointer to the data to copy
     * @param size (Optional) Size of the data to copy. Pass VK_WHOLE_SIZE to flush the complete buffer
     * range.
     * @param offset (Optional) Byte offset from beginning of mapped region
     *
     */
    void Buffer::readFromBuffer(void *data, VkDeviceSize size, VkDeviceSize offset) {
        assert(this->mapped && "Cannot copy from unmapped buffer");

        if (size == VK_WHOLE_SIZE) {
            memcpy(data, this->mapped, this->bufferSize);
        } else {
            char *memOffset = (char *) this->mapped;
            memOffset += offset;
            memcpy(data, memOffset, size);
        }
    }

    /**
     * Flush a memory range of the buffer to make it visible to the device
     *
     * @note Only required for non-coherent memory
     *
     * @param size (Optional) Size of the memory range to flush. Pass VK_WHOLE_SIZE to flush the
     * complete buffer range.
     * @param offset (Optional) Byte offset from beginning
     *
     * @return VkResult of the flush call
     */
    VkResult Buffer::flush(VkDeviceSize size, VkDeviceSize offset) {
        return vmaFlushAllocation(this->device->getMemoryAllocator(), this->memoryAllocation, offset, size);
    }

    /**
     * Invalidate a memory range of the buffer to make it visible to the host
     *
     * @note Only required for non-coherent memory
     *
     * @param size (Optional) Size of the memory range to invalidate. Pass VK_WHOLE_SIZE to invalidate
     * the complete buffer range.
     * @param offset (Optional) Byte offset from beginning
     *
     * @return VkResult of the invalidate call
     */
    VkResult Buffer::invalidate(VkDeviceSize size, VkDeviceSize offset) {
        return vmaInvalidateAllocation(this->device->getMemoryAllocator(), this->memoryAllocation, offset, size);
    }

    /**
     * Create a buffer info descriptor
     *
     * @param size (Optional) Size of the memory range of the descriptor
     * @param offset (Optional) Byte offset from beginning
     *
     * @return VkDescriptorBufferInfo of specified offset and range
     */
    VkDescriptorBufferInfo Buffer::descriptorInfo(VkDeviceSize size, VkDeviceSize offset) {
        return VkDescriptorBufferInfo{
                this->buffer,
                offset,
                size,
        };
    }

    /**
     * Copies "instanceSize" bytes of data to the mapped buffer at an offset of index * alignmentSize
     *
     * @param data Pointer to the data to copy
     * @param index Used in offset calculation
     *
     */
    void Buffer::writeToIndex(void *data, int index) {
        this->writeToBuffer(data, this->instanceSize, index * this->alignmentSize);
    }

    /**
     * Copies "instanceSize" bytes of data from the mapped buffer at an offset of index * alignmentSize
     *
     * @param data Pointer to the data to copy
     * @param index Used in offset calculation
     *
     */
    void Buffer::readFromIndex(void *data, int index) {
        this->readFromBuffer(data, this->instanceSize, index * this->alignmentSize);
    }

    /**
     *  Flush the memory range at index * alignmentSize of the buffer to make it visible to the device
     *
     * @param index Used in offset calculation
     *
     */
    VkResult Buffer::flushIndex(int index) {
        return this->flush(this->alignmentSize, index * this->alignmentSize);
    }

    /**
     * Create a buffer info descriptor
     *
     * @param index Specifies the region given by index * alignmentSize
     *
     * @return VkDescriptorBufferInfo for instance at index
     */
    VkDescriptorBufferInfo Buffer::descriptorInfoForIndex(int index) {
        return this->descriptorInfo(this->alignmentSize, index * this->alignmentSize);
    }

    /**
     * Invalidate a memory range of the buffer to make it visible to the host
     *
     * @note Only required for non-coherent memory
     *
     * @param index Specifies the region to invalidate: index * alignmentSize
     *
     * @return VkResult of the invalidate call
     */
    VkResult Buffer::invalidateIndex(int index) {
        return this->invalidate(this->alignmentSize, index * this->alignmentSize);
    }

    void
    Buffer::transitionBuffer(CommandBuffer *commandBuffer, VkPipelineStageFlags srcStage, VkPipelineStageFlags dstStage,
                             VkAccessFlags srcAccess, VkAccessFlags dstAccess, uint32_t srcQueueFamilyIndex,
                             uint32_t dstQueueFamilyIndex) {
        VkBufferMemoryBarrier barrier{};
        barrier.sType = VK_STRUCTURE_TYPE_BUFFER_MEMORY_BARRIER;

        barrier.srcQueueFamilyIndex = srcQueueFamilyIndex;
        barrier.dstQueueFamilyIndex = dstQueueFamilyIndex;

        barrier.buffer = this->buffer;
        barrier.size = this->bufferSize;
        barrier.offset = 0;
        barrier.srcAccessMask = srcAccess;
        barrier.dstAccessMask = dstAccess;

        vkCmdPipelineBarrier(
                commandBuffer->getCommandBuffer(),
                srcStage,
                dstStage,
                0,
                0,
                nullptr,
                1,
                &barrier,
                0,
                nullptr
        );
    }

    void Buffer::transitionBuffer(CommandBuffer *commandBuffer, VkDeviceSize size, VkDeviceSize offset,
                                  VkPipelineStageFlags srcStage,
                                  VkPipelineStageFlags dstStage, VkAccessFlags srcAccess, VkAccessFlags dstAccess,
                                  uint32_t srcQueueFamilyIndex, uint32_t dstQueueFamilyIndex) {
        VkBufferMemoryBarrier barrier{};
        barrier.sType = VK_STRUCTURE_TYPE_BUFFER_MEMORY_BARRIER;

        barrier.srcQueueFamilyIndex = srcQueueFamilyIndex;
        barrier.dstQueueFamilyIndex = dstQueueFamilyIndex;

        barrier.buffer = this->buffer;
        barrier.size = size;
        barrier.offset = offset;
        barrier.srcAccessMask = srcAccess;
        barrier.dstAccessMask = dstAccess;

        vkCmdPipelineBarrier(
                commandBuffer->getCommandBuffer(),
                srcStage,
                dstStage,
                0,
                0,
                nullptr,
                1,
                &barrier,
                0,
                nullptr
        );
    }

    void Buffer::transitionBuffer(CommandBuffer *commandBuffer, const std::vector<Buffer *> &buffers,
                                  VkPipelineStageFlags srcStage, VkPipelineStageFlags dstStage,
                                  VkAccessFlags srcAccess, VkAccessFlags dstAccess, uint32_t srcQueueFamilyIndex,
                                  uint32_t dstQueueFamilyIndex) {
        std::vector<VkBufferMemoryBarrier> barriers{};

        for (auto &&buffer: buffers) {
            VkBufferMemoryBarrier barrier{};
            barrier.sType = VK_STRUCTURE_TYPE_BUFFER_MEMORY_BARRIER;

            barrier.srcQueueFamilyIndex = srcQueueFamilyIndex;
            barrier.dstQueueFamilyIndex = dstQueueFamilyIndex;

            barrier.buffer = buffer->getBuffer();
            barrier.size = buffer->getBufferSize();
            barrier.offset = 0;
            barrier.srcAccessMask = srcAccess;
            barrier.dstAccessMask = dstAccess;

            barriers.emplace_back(barrier);
        }

        vkCmdPipelineBarrier(
                commandBuffer->getCommandBuffer(),
                srcStage,
                dstStage,
                0,
                0,
                nullptr,
                static_cast<uint32_t>(barriers.size()),
                barriers.data(),
                0,
                nullptr
        );
    }

    void Buffer::createBuffer(VkDeviceSize size, VkBufferUsageFlags usage, VmaMemoryUsage memoryUsage,
                              VmaAllocationCreateFlags memoryAllocFlag) {
        VkBufferCreateInfo bufferInfo{};
        bufferInfo.sType = VK_STRUCTURE_TYPE_BUFFER_CREATE_INFO;
        bufferInfo.size = size;
        bufferInfo.usage = usage;
        bufferInfo.sharingMode = VK_SHARING_MODE_EXCLUSIVE;

        VmaAllocationCreateInfo allocInfo = {};
        allocInfo.usage = memoryUsage;
        allocInfo.flags = memoryAllocFlag;

        if (vmaCreateBuffer(this->device->getMemoryAllocator(), &bufferInfo, &allocInfo, &this->buffer,
                            &this->memoryAllocation, nullptr) != VK_SUCCESS) {
            throw std::runtime_error("failed to create buffer!");
        }
    }

    void Buffer::copyFromAnotherBuffer(CommandBuffer *commandBuffer, Buffer *srcBuffer, VkDeviceSize size,
                                       VkDeviceSize srcOffset, VkDeviceSize dstOffset) {
        VkBufferCopy copyRegion{};
        copyRegion.srcOffset = srcOffset;
        copyRegion.dstOffset = dstOffset;
        copyRegion.size = (size == VK_WHOLE_SIZE) ? srcBuffer->getBufferSize() : size;

        vkCmdCopyBuffer(commandBuffer->getCommandBuffer(), srcBuffer->getBuffer(), this->buffer, 1, &copyRegion);
    }

    void Buffer::copyToAnotherBuffer(CommandBuffer *commandBuffer, Buffer *destBuffer, VkDeviceSize size,
                                     VkDeviceSize srcOffset, VkDeviceSize dstOffset) {
        VkBufferCopy copyRegion{};
        copyRegion.srcOffset = srcOffset;
        copyRegion.dstOffset = dstOffset;
        copyRegion.size = (size == VK_WHOLE_SIZE) ? this->bufferSize : size;

        vkCmdCopyBuffer(commandBuffer->getCommandBuffer(), this->buffer, destBuffer->getBuffer(), 1, &copyRegion);
    }

    void
    Buffer::copyBufferToImage(CommandBuffer *commandBuffer, Image *destImage, uint32_t srcOffset, uint32_t dstMipLevel,
                              uint32_t dstLayer) {
        VkBufferImageCopy region{};
        region.bufferOffset = srcOffset;
        region.bufferRowLength = 0;
        region.bufferImageHeight = 0;

        region.imageSubresource.aspectMask = destImage->getAspectFlag();
        region.imageSubresource.mipLevel = dstMipLevel;
        region.imageSubresource.baseArrayLayer = dstLayer;
        region.imageSubresource.layerCount = destImage->getLayerNum();

        region.imageOffset = {0, 0, 0};
        region.imageExtent = {destImage->getWidth(), destImage->getHeight(), 1};

        vkCmdCopyBufferToImage(
                commandBuffer->getCommandBuffer(),
                this->buffer,
                destImage->getImage(),
                VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL,
                1,
                &region
        );
    }

    void
    Buffer::copyImageToBuffer(CommandBuffer *commandBuffer, Image *srcImage, uint32_t dstOffset, uint32_t srcMipLevel,
                              uint32_t srcLayer) {
        VkBufferImageCopy region{};
        region.bufferOffset = dstOffset;
        region.bufferRowLength = 0;
        region.bufferImageHeight = 0;

        region.imageSubresource.aspectMask = srcImage->getAspectFlag();
        region.imageSubresource.mipLevel = srcMipLevel;
        region.imageSubresource.baseArrayLayer = srcLayer;
        region.imageSubresource.layerCount = srcImage->getLayerNum();

        region.imageOffset = {0, 0, 0};
        region.imageExtent = {srcImage->getWidth(), srcImage->getHeight(), 1};

        vkCmdCopyImageToBuffer(
                commandBuffer->getCommandBuffer(),
                srcImage->getImage(),
                VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL,
                this->buffer,
                1,
                &region
        );
    }

    void Buffer::fillBuffer(CommandBuffer *commandBuffer, uint32_t data, VkDeviceSize size, VkDeviceSize offset) {
        vkCmdFillBuffer(commandBuffer->getCommandBuffer(), this->buffer, offset, size, data);
    }
}  // namespace lve