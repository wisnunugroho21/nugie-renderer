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

      void resetCommand();
      void beginSingleTimeCommand();
      void beginReccuringCommand();
      void endCommand();
      void submitCommand(VkQueue queue, std::vector<VkSemaphore> waitSemaphores = {}, 
        std::vector<VkPipelineStageFlags> waitStages = {}, std::vector<VkSemaphore> signalSemaphores = {}, 
        VkFence fence = VK_NULL_HANDLE);

      static void submitCommands(std::vector<CommandBuffer*> commandBuffers, VkQueue queue, std::vector<VkSemaphore> waitSemaphores = {}, 
        std::vector<VkPipelineStageFlags> waitStages = {}, std::vector<VkSemaphore> signalSemaphores = {}, 
        VkFence fence = VK_NULL_HANDLE);

      VkCommandBuffer getCommandBuffer() { return this->commandBuffer; }

    private:
      Device* device;
      VkCommandBuffer commandBuffer;
  };
  
} // namespace NugieVulkan

