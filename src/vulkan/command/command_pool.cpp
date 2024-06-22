#include "command_pool.hpp"

// std
#include <cassert>
#include <stdexcept>

namespace NugieVulkan {
    CommandPool::CommandPool(
            Device *device,
            uint32_t queueFamilyIndex,
            VkCommandPoolCreateFlags flags)
            : device{device} 
    {
        this->createCommandPool(queueFamilyIndex, flags);
    }

    CommandPool::CommandPool(
            Device *device,
            uint32_t queueFamilyIndex)
            : device{device} 
    {
        this->createCommandPool(queueFamilyIndex);
    }

    void CommandPool::createCommandPool(uint32_t queueFamilyIndex, VkCommandPoolCreateFlags flags) {
        VkCommandPoolCreateInfo poolInfo = {};
        poolInfo.sType = VK_STRUCTURE_TYPE_COMMAND_POOL_CREATE_INFO;
        poolInfo.queueFamilyIndex = queueFamilyIndex;
        poolInfo.flags = flags;

        if (vkCreateCommandPool(this->device->getLogicalDevice(), &poolInfo, nullptr, &this->commandPool) !=
            VK_SUCCESS) {
            throw std::runtime_error("failed to create command pool!");
        }
    }

    void CommandPool::createCommandPool(uint32_t queueFamilyIndex) {
        VkCommandPoolCreateInfo poolInfo = {};
        poolInfo.sType = VK_STRUCTURE_TYPE_COMMAND_POOL_CREATE_INFO;
        poolInfo.queueFamilyIndex = queueFamilyIndex;

        if (vkCreateCommandPool(this->device->getLogicalDevice(), &poolInfo, nullptr, &this->commandPool) !=
            VK_SUCCESS) {
            throw std::runtime_error("failed to create command pool!");
        }
    }

    CommandPool::~CommandPool() {
        vkDestroyCommandPool(this->device->getLogicalDevice(), this->commandPool, nullptr);
    }

    bool CommandPool::allocate(VkCommandBuffer *commandBuffer) const {
        VkCommandBufferAllocateInfo allocInfo{};
        allocInfo.sType = VK_STRUCTURE_TYPE_COMMAND_BUFFER_ALLOCATE_INFO;
        allocInfo.level = VK_COMMAND_BUFFER_LEVEL_PRIMARY;
        allocInfo.commandPool = this->commandPool;
        allocInfo.commandBufferCount = 1u;

        if (vkAllocateCommandBuffers(this->device->getLogicalDevice(), &allocInfo, commandBuffer) != VK_SUCCESS) {
            return false;
        }

        return true;
    }

    bool CommandPool::allocate(std::vector<VkCommandBuffer> &commandBuffers) const {
        VkCommandBufferAllocateInfo allocInfo{};
        allocInfo.sType = VK_STRUCTURE_TYPE_COMMAND_BUFFER_ALLOCATE_INFO;
        allocInfo.level = VK_COMMAND_BUFFER_LEVEL_PRIMARY;
        allocInfo.commandPool = this->commandPool;
        allocInfo.commandBufferCount = static_cast<uint32_t>(commandBuffers.size());

        if (vkAllocateCommandBuffers(this->device->getLogicalDevice(), &allocInfo, commandBuffers.data()) !=
            VK_SUCCESS) {
            return false;
        }

        return true;
    }

    void CommandPool::free(VkCommandBuffer *commandBuffer) const {
        vkFreeCommandBuffers(
                this->device->getLogicalDevice(),
                this->commandPool,
                1u,
                commandBuffer
        );
    }

    void CommandPool::free(const std::vector<VkCommandBuffer> &commandBuffers) const {
        vkFreeCommandBuffers(
                this->device->getLogicalDevice(),
                this->commandPool,
                static_cast<uint32_t>(commandBuffers.size()),
                commandBuffers.data()
        );
    }

    void CommandPool::reset() {
        vkResetCommandPool(this->device->getLogicalDevice(), this->commandPool, 0);
    }
}