#pragma once

#include "../device/device.hpp"
#include "command_buffer.hpp"

#include <vector>
#include <memory>

namespace NugieVulkan {
    class CommandPool {
    public:
        CommandPool(
                Device *device,
                uint32_t queueFamilyIndex,
                VkCommandPoolCreateFlags flags
        );

        CommandPool(
                Device *device,
                uint32_t queueFamilyIndex
        );

        ~CommandPool();

        bool allocate(VkCommandBuffer *commandBuffer) const;

        bool allocate(std::vector<VkCommandBuffer> &commandBuffers) const;

        void free(VkCommandBuffer *commandBuffer) const;

        void free(const std::vector<VkCommandBuffer> &commandBuffers) const;

        void reset();

    private:
        void createCommandPool(uint32_t queueFamilyIndex, VkCommandPoolCreateFlags flags);

        void createCommandPool(uint32_t queueFamilyIndex);

        Device *device = nullptr;
        VkCommandPool commandPool;
    };
}