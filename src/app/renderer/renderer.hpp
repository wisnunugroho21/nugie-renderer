#pragma once

#include "../../vulkan/window/window.hpp"
#include "../../vulkan/device/device.hpp"
#include "../../vulkan/swap_chain/swap_chain.hpp"
#include "../../vulkan/buffer/buffer.hpp"
#include "../../vulkan/descriptor/descriptor_pool.hpp"
#include "../../vulkan/command/command_buffer.hpp"
#include "../general_struct.hpp"

#include <memory>
#include <vector>
#include <cassert>

namespace NugieApp {
	class Renderer
	{
		public:
			Renderer(NugieVulkan::Window* window, NugieVulkan::Device* device);
			~Renderer();

			NugieVulkan::SwapChain* getSwapChain() const { return this->swapChain; }
			NugieVulkan::DescriptorPool* getDescriptorPool() const { return this->descriptorPool; }
			bool isFrameInProgress() const { return this->isFrameStarted; }

			uint32_t getFrameIndex() {
				assert(this->isFrameStarted && "cannot get frame index when frame is not in progress");
				return this->currentFrameIndex;
			}

			uint32_t getImageIndex() {
				assert(this->isFrameStarted && "cannot get image index when frame is not in progress");
				return this->currentImageIndex;
			}

			NugieVulkan::CommandBuffer* beginRenderCommand();
			NugieVulkan::CommandBuffer* beginRenderCommand(uint32_t frameIndex);

			NugieVulkan::CommandBuffer* beginTransferCommand();

			void submitRenderCommands(std::vector<NugieVulkan::CommandBuffer*> commandBuffer, bool isWaitTransfer = false);
			void submitRenderCommand(NugieVulkan::CommandBuffer* commandBuffer, bool isWaitTransfer = false);

			void submitTransferCommand(NugieVulkan::CommandBuffer* commandBuffer);

			bool acquireFrame();
			bool presentFrame();

		private:
			void recreateSwapChain();
			void createSyncObjects();
			void createDescriptorPool();
			void createCommandPool();
			void createCommandBuffers();

			NugieVulkan::Window* window;
			NugieVulkan::Device* device;
			uint32_t imageCount;
			
			NugieVulkan::DescriptorPool* descriptorPool;
			NugieVulkan::SwapChain* swapChain;

			NugieVulkan::CommandPool* graphicCommandPool;
			NugieVulkan::CommandPool* transferCommandPool;

			std::vector<NugieVulkan::CommandBuffer*> graphicCommandBuffers;
			std::vector<NugieVulkan::CommandBuffer*> transferCommandBuffers;

			std::vector<VkSemaphore> imageAvailableSemaphores, renderFinishedSemaphores, transferFinishSemaphores;
			std::vector<VkFence> inFlightFences;

			uint32_t currentImageIndex = 0, currentFrameIndex = 0;
			bool isFrameStarted = false, isLoadResouce = false;
	};
}