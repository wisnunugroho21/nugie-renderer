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
	class HybridRenderer
	{
		public:
			HybridRenderer(NugieVulkan::Window* window, NugieVulkan::Device* device);
			~HybridRenderer();

			NugieVulkan::SwapChain* getSwapChain() const { return this->swapChain; }
			NugieVulkan::DescriptorPool* getDescriptorPool() const { return this->descriptorPool; }
			bool isFrameInProgress() const { return this->isFrameStarted; }

			uint32_t getFrameIndex() {
				assert(this->isFrameStarted && "cannot get frame index when frame is not in progress");
				return this->currentFrameIndex;
			}

			uint32_t getImageIndex() {
				assert(this->isFrameStarted && "cannot get frame index when frame is not in progress");
				return this->currentImageIndex;
			}

			NugieVulkan::CommandBuffer* beginRenderCommand();
			NugieVulkan::CommandBuffer* beginTransferCommand();

			void endRenderCommand(NugieVulkan::CommandBuffer* commandBuffer);
			void endTransferCommand(NugieVulkan::CommandBuffer* commandBuffer);

			void submitRenderCommands(std::vector<NugieVulkan::CommandBuffer*> commandBuffer);
			void submitRenderCommand(NugieVulkan::CommandBuffer* commandBuffer);

			void submitTransferCommand(NugieVulkan::CommandBuffer* commandBuffer);

			bool acquireFrame();
			bool presentFrame();

		private:
			void recreateSwapChain();
			void createSyncObjects(uint32_t imageCount);
			void createDescriptorPool();
			void createCommandPool();
			void createCommandBuffers();

			NugieVulkan::Window* window;
			NugieVulkan::Device* device;
			
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