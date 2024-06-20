#pragma once

#include "../../../vulkan/device/device.hpp"
#include "../../../vulkan/buffer/buffer.hpp"
#include "../../../vulkan/command/command_buffer.hpp"

#include <vector>
#include <memory>

namespace NugieApp {
    template<typename T>
    class ArrayBuffer {
    public:
        ArrayBuffer(NugieVulkan::Device *device, VkBufferUsageFlags usageFlags, uint32_t instanceCount = 1000000u,
                    bool isAlsoCreateStaging = true);

        ~ArrayBuffer();

        VkDescriptorBufferInfo getInfo() const { return this->buffer->descriptorInfo(); }

        NugieVulkan::Buffer *getBuffer() const { return this->buffer; }

        uint32_t size() const { return this->count; }

        void replace(NugieVulkan::CommandBuffer *commandBuffer, std::vector<T> objects);

        void initializeValue(NugieVulkan::CommandBuffer *commandBuffer, uint32_t value = 0u);

    private:
        NugieVulkan::Device *device = nullptr;

        uint32_t count;
        bool isAlsoCreateStaging;

        NugieVulkan::Buffer *stagingBuffer = nullptr;
        NugieVulkan::Buffer *buffer = nullptr;

        void createBuffers(VkBufferUsageFlags usageFlags, uint32_t instanceCount);
    };

    template<typename T>
    ArrayBuffer<T>::ArrayBuffer(NugieVulkan::Device *device, VkBufferUsageFlags usageFlags, uint32_t instanceCount,
                                bool isAlsoCreateStaging) : device{device}, isAlsoCreateStaging{isAlsoCreateStaging} {
        this->createBuffers(usageFlags, instanceCount);
    }

    template<typename T>
    ArrayBuffer<T>::~ArrayBuffer() {
        delete this->stagingBuffer;
        delete this->buffer;
    }

    template<typename T>
    void ArrayBuffer<T>::createBuffers(VkBufferUsageFlags usageFlags, uint32_t instanceCount) {
        auto instanceSize = static_cast<uint32_t>(sizeof(T));

        if (!(usageFlags & (1 << VK_BUFFER_USAGE_TRANSFER_DST_BIT)) && this->isAlsoCreateStaging) {
            usageFlags |= VK_BUFFER_USAGE_TRANSFER_DST_BIT;
        }

        this->buffer = new NugieVulkan::Buffer(
                this->device,
                instanceSize,
                instanceCount,
                usageFlags,
                VMA_MEMORY_USAGE_AUTO,
                VMA_ALLOCATION_CREATE_DEDICATED_MEMORY_BIT
        );

        if (this->isAlsoCreateStaging) {
            this->stagingBuffer = new NugieVulkan::Buffer(
                    this->device,
                    instanceSize,
                    instanceCount,
                    VK_BUFFER_USAGE_TRANSFER_SRC_BIT,
                    VMA_MEMORY_USAGE_AUTO,
                    VMA_ALLOCATION_CREATE_HOST_ACCESS_SEQUENTIAL_WRITE_BIT | VMA_ALLOCATION_CREATE_MAPPED_BIT
            );

            this->stagingBuffer->map();
        }
    }

    template<typename T>
    void ArrayBuffer<T>::replace(NugieVulkan::CommandBuffer *commandBuffer, std::vector<T> objects) {
        assert(this->isAlsoCreateStaging && "staging buffer has not created yet!");

        this->count = static_cast<uint32_t>(objects.size());
        auto bufferSize = static_cast<VkDeviceSize>(sizeof(T)) * static_cast<VkDeviceSize>(this->count);

        this->stagingBuffer->writeToBuffer((void *) objects.data(), bufferSize);
        this->buffer->copyFromAnotherBuffer(commandBuffer, this->stagingBuffer, bufferSize);
    }

    template<typename T>
    void ArrayBuffer<T>::initializeValue(NugieVulkan::CommandBuffer *commandBuffer, uint32_t value) {
        this->buffers->fillBuffer(commandBuffer, value);
    }
} // namespace NugieApp
