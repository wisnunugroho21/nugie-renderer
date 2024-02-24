#pragma once

#include "../device/device.hpp"
#include "command_pool.hpp"

#include <vector>
#include <memory>

namespace NugieVulkan
{
  class CommandBuffer {
    public:
      CommandBuffer(Device* device, VkCommandBuffer commandBuffer);

      VkCommandBuffer getCommandBuffer() const { return this->commandBuffer; }

      void resetCommand();
      void beginSingleTimeCommand();
      void beginReccuringCommand();
      void endCommand();
      void submitCommand(VkQueue queue, const std::vector<VkSemaphore> &waitSemaphores = {}, 
        const std::vector<VkPipelineStageFlags> &waitStages = {}, const std::vector<VkSemaphore> &signalSemaphores = {}, 
        VkFence fence = VK_NULL_HANDLE);

      static void submitCommands(const std::vector<CommandBuffer*> &commandBuffers, VkQueue queue, const std::vector<VkSemaphore> &waitSemaphores = {}, 
        const std::vector<VkPipelineStageFlags> &waitStages = {}, const std::vector<VkSemaphore> &signalSemaphores = {}, 
        VkFence fence = VK_NULL_HANDLE);

    private:
      Device* device = nullptr;
      VkCommandBuffer commandBuffer;
  };
  
} // namespace NugieVulkan

