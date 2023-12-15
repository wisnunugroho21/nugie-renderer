#include "command_buffer.hpp"

#include <iostream>

namespace NugieVulkan {
	CommandBuffer::CommandBuffer(Device* device, VkCommandBuffer commandBuffer) 
		: device{device}, commandBuffer {commandBuffer} 
	{

	}

	void CommandBuffer::resetCommand() {
		vkResetCommandBuffer(this->commandBuffer, VK_COMMAND_BUFFER_RESET_RELEASE_RESOURCES_BIT);
	}

	void CommandBuffer::beginSingleTimeCommand() {
		VkCommandBufferBeginInfo beginInfo{};
		beginInfo.sType = VK_STRUCTURE_TYPE_COMMAND_BUFFER_BEGIN_INFO;
		beginInfo.flags = VK_COMMAND_BUFFER_USAGE_ONE_TIME_SUBMIT_BIT;

		if (vkBeginCommandBuffer(this->commandBuffer, &beginInfo) != VK_SUCCESS) {
			std::cerr << "Failed to start recording buffer" << '\n';
		}
	}

	void CommandBuffer::beginReccuringCommand() {
		VkCommandBufferBeginInfo beginInfo{};
		beginInfo.sType = VK_STRUCTURE_TYPE_COMMAND_BUFFER_BEGIN_INFO;

		if (vkBeginCommandBuffer(this->commandBuffer, &beginInfo) != VK_SUCCESS) {
			std::cerr << "Failed to start recording command buffer" << '\n';
		}
	}

	void CommandBuffer::endCommand() {
		if (vkEndCommandBuffer(this->commandBuffer) != VK_SUCCESS) {
			std::cerr << "Failed to end recording command buffer" << '\n';
		}
	}

	void CommandBuffer::submitCommand(VkQueue queue, const std::vector<VkSemaphore> &waitSemaphores, 
    const std::vector<VkPipelineStageFlags> &waitStages, const std::vector<VkSemaphore> &signalSemaphores, VkFence fence) 
	{
		VkSubmitInfo submitInfo{};
		submitInfo.sType = VK_STRUCTURE_TYPE_SUBMIT_INFO;
		submitInfo.commandBufferCount = 1;
		submitInfo.pCommandBuffers = &this->commandBuffer;

		submitInfo.waitSemaphoreCount = static_cast<uint32_t>(waitSemaphores.size());
		if (waitSemaphores.size() == 0) {
  		submitInfo.pWaitSemaphores = nullptr;
		} else {
			submitInfo.pWaitSemaphores = waitSemaphores.data();
		}

		if (waitStages.size() > 0) {
			submitInfo.pWaitDstStageMask = waitStages.data();
		}

		submitInfo.signalSemaphoreCount = static_cast<uint32_t>(signalSemaphores.size());
		if (signalSemaphores.size() == 0) {
  		submitInfo.pSignalSemaphores = nullptr;
		} else {
			submitInfo.pSignalSemaphores = signalSemaphores.data();
		}

		if (vkQueueSubmit(queue, 1, &submitInfo, fence) != VK_SUCCESS) {
			std::cerr << "Failed to submitting command buffer" << '\n';
		}
	}

	void CommandBuffer::submitCommands(const std::vector<CommandBuffer*> &commandBuffers, VkQueue queue, const std::vector<VkSemaphore> &waitSemaphores, 
		const std::vector<VkPipelineStageFlags> &waitStages, const std::vector<VkSemaphore> &signalSemaphores, VkFence fence) 
	{
		std::vector<VkCommandBuffer> buffers{};
		for (auto& commandBuffer : commandBuffers) {
			buffers.push_back(commandBuffer->getCommandBuffer());
		}

		VkSubmitInfo submitInfo{};
		submitInfo.sType = VK_STRUCTURE_TYPE_SUBMIT_INFO;
		submitInfo.commandBufferCount = static_cast<uint32_t>(buffers.size());
		submitInfo.pCommandBuffers = buffers.data();

		submitInfo.waitSemaphoreCount = static_cast<uint32_t>(waitSemaphores.size());
		if (waitSemaphores.size() == 0) {
  		submitInfo.pWaitSemaphores = nullptr;
		} else {
			submitInfo.pWaitSemaphores = waitSemaphores.data();
		}

		if (waitStages.size() > 0) {
			submitInfo.pWaitDstStageMask = waitStages.data();
		}

		submitInfo.signalSemaphoreCount = static_cast<uint32_t>(signalSemaphores.size());
		if (signalSemaphores.size() == 0) {
  		submitInfo.pSignalSemaphores = nullptr;
		} else {
			submitInfo.pSignalSemaphores = signalSemaphores.data();
		}

		if (vkQueueSubmit(queue, 1, &submitInfo, fence) != VK_SUCCESS) {
			std::cerr << "Failed to submitting command buffer" << '\n';
		}
	}
} // namespace NugieVulkan
