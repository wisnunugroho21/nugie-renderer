#include "renderer.hpp"

#include <stdexcept>
#include <array>
#include <string>

namespace NugieApp {
	Renderer::Renderer(NugieVulkan::Window* window, NugieVulkan::Device* device) : device{device}, window{window} {
		this->recreateSwapChain();
		this->createSyncObjects(static_cast<uint32_t>(this->swapChain->getImageCount()));

		this->createDescriptorPool();
		this->createCommandPool();
		this->createCommandBuffers();
	}

	Renderer::~Renderer() {
		this->descriptorPool->reset();
		
    for (size_t i = 0; i < NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT; i++) {
			vkDestroySemaphore(this->device->getLogicalDevice(), this->renderFinishedSemaphores[i], nullptr);
			vkDestroySemaphore(this->device->getLogicalDevice(), this->imageAvailableSemaphores[i], nullptr);
			vkDestroyFence(this->device->getLogicalDevice(), this->inFlightFences[i], nullptr);

			if (this->graphicCommandBuffers[i] != nullptr) delete this->graphicCommandBuffers[i];
		}

		vkDestroySemaphore(this->device->getLogicalDevice(), this->transferFinishSemaphores[0], nullptr);
		if (this->transferCommandBuffers[0] != nullptr) delete this->transferCommandBuffers[0];

		if (this->graphicCommandPool != nullptr) delete this->graphicCommandPool;
		if (this->transferCommandPool != nullptr) delete this->transferCommandPool;

		if (this->descriptorPool != nullptr) delete this->descriptorPool;
		if (this->swapChain != nullptr) delete this->swapChain;
	}

	void Renderer::recreateSwapChain() {
		auto extent = this->window->getExtent();
		while(extent.width == 0 || extent.height == 0) {
			extent = this->window->getExtent();
			glfwWaitEvents();
		}

		vkDeviceWaitIdle(this->device->getLogicalDevice());

		if (this->swapChain == nullptr) {
			this->swapChain = new NugieVulkan::SwapChain(this->device, extent);
		} else {
			auto oldSwapChain = this->swapChain;
			this->swapChain = new NugieVulkan::SwapChain(this->device, extent, oldSwapChain);

			if (!oldSwapChain->compareSwapFormat(this->swapChain)) {
				throw std::runtime_error("Swap chain image has changed");
			}
		}
	}

	void Renderer::createDescriptorPool() {
		this->descriptorPool = 
			NugieVulkan::DescriptorPool::Builder(this->device)
				.setPoolFlags(VK_DESCRIPTOR_POOL_CREATE_FREE_DESCRIPTOR_SET_BIT)
				.setMaxSets(100)
				.addPoolSize(VK_DESCRIPTOR_TYPE_STORAGE_IMAGE, 100)
				.addPoolSize(VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, 100)
				.addPoolSize(VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 100)
				.addPoolSize(VK_DESCRIPTOR_TYPE_INPUT_ATTACHMENT, 100)
				.addPoolSize(VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER, 100)
				.build();
	}

	void Renderer::createCommandPool() {
		auto queueFamily = this->device->getPhysicalQueueFamilies();
		this->graphicCommandPool = new NugieVulkan::CommandPool(
			this->device, 
			queueFamily.graphicsFamily, 
			VK_COMMAND_POOL_CREATE_TRANSIENT_BIT | VK_COMMAND_POOL_CREATE_RESET_COMMAND_BUFFER_BIT
		);

		this->transferCommandPool = new NugieVulkan::CommandPool(
			this->device, 
			queueFamily.transferFamily, 
			VK_COMMAND_POOL_CREATE_TRANSIENT_BIT | VK_COMMAND_POOL_CREATE_RESET_COMMAND_BUFFER_BIT
		);
	}

	void Renderer::createSyncObjects(uint32_t imageCount) {
		imageAvailableSemaphores.resize(NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT);
		renderFinishedSemaphores.resize(NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT);
		inFlightFences.resize(NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT);
		transferFinishSemaphores.resize(1);

		VkSemaphoreCreateInfo semaphoreInfo = {};
		semaphoreInfo.sType = VK_STRUCTURE_TYPE_SEMAPHORE_CREATE_INFO;

		VkFenceCreateInfo fenceInfo = {};
		fenceInfo.sType = VK_STRUCTURE_TYPE_FENCE_CREATE_INFO;
		fenceInfo.flags = VK_FENCE_CREATE_SIGNALED_BIT;

		for (size_t i = 0; i < NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT; i++) {
		  if (vkCreateSemaphore(this->device->getLogicalDevice(), &semaphoreInfo, nullptr, &this->imageAvailableSemaphores[i]) != VK_SUCCESS ||
				vkCreateSemaphore(this->device->getLogicalDevice(), &semaphoreInfo, nullptr, &this->renderFinishedSemaphores[i]) != VK_SUCCESS ||
				vkCreateFence(this->device->getLogicalDevice(), &fenceInfo, nullptr, &this->inFlightFences[i]) != VK_SUCCESS) 
			{
				throw std::runtime_error("failed to create synchronization objects for a frame!");
		  }
		}

		if (vkCreateSemaphore(this->device->getLogicalDevice(), &semaphoreInfo, nullptr, &this->transferFinishSemaphores[0]) != VK_SUCCESS) {
			throw std::runtime_error("failed to create synchronization objects for transfer operation!");
		}
	}

	void Renderer::createCommandBuffers() {
		std::vector<VkCommandBuffer> commandBuffers;
		commandBuffers.resize(NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT);

		this->graphicCommandPool->allocate(commandBuffers);
		this->graphicCommandBuffers.clear();
		
		for (uint32_t i = 0; i < NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT; i++) {
			this->graphicCommandBuffers.emplace_back(new NugieVulkan::CommandBuffer(this->device, commandBuffers[i]));
		}

		VkCommandBuffer transferCommandBuffer;
		this->transferCommandPool->allocate(&transferCommandBuffer);

		this->transferCommandBuffers.clear();
		this->transferCommandBuffers.emplace_back(new NugieVulkan::CommandBuffer(this->device, transferCommandBuffer));
	}

	bool Renderer::acquireFrame() {
		assert(!this->isFrameStarted && "can't acquire frame while frame still in progress");

		std::vector<VkFence> acquireFrameFences = { this->inFlightFences[this->currentFrameIndex] };
		auto result = this->swapChain->acquireNextImage(&this->currentImageIndex, acquireFrameFences, this->imageAvailableSemaphores[this->currentFrameIndex]);
		
		if (result == VK_ERROR_OUT_OF_DATE_KHR) {
			this->recreateSwapChain();
			return false;
		}

		if (result != VK_SUCCESS && result != VK_SUBOPTIMAL_KHR) {
			throw std::runtime_error("failed to acquire swap chain image");
		}

		this->isFrameStarted = true;
		return true;
	}

	NugieVulkan::CommandBuffer* Renderer::beginRenderCommand() {
		assert(this->isFrameStarted && "can't start command while frame still in progress");

		this->graphicCommandBuffers[this->currentFrameIndex]->resetCommand();
		this->graphicCommandBuffers[this->currentFrameIndex]->beginReccuringCommand();

		return this->graphicCommandBuffers[this->currentFrameIndex];
	}

	NugieVulkan::CommandBuffer* Renderer::beginTransferCommand() {
		this->transferCommandBuffers[0]->resetCommand();
		this->transferCommandBuffers[0]->beginReccuringCommand();

		return this->transferCommandBuffers[0];
	}

	void Renderer::endRenderCommand(NugieVulkan::CommandBuffer* commandBuffer) {
		assert(this->isFrameStarted && "can't start command while frame still in progress");
		commandBuffer->endCommand();
	}

	void Renderer::endTransferCommand(NugieVulkan::CommandBuffer* commandBuffer) {
		commandBuffer->endCommand();
	}

	void Renderer::submitRenderCommands(std::vector<NugieVulkan::CommandBuffer*> commandBuffers, bool isWaitTransfer) {
		assert(this->isFrameStarted && "can't submit command if frame is not in progress");
		vkResetFences(this->device->getLogicalDevice(), 1, &this->inFlightFences[this->currentFrameIndex]);

		std::vector<VkSemaphore> waitSemaphores = { this->imageAvailableSemaphores[this->currentFrameIndex] };
		std::vector<VkSemaphore> signalSemaphores = { this->renderFinishedSemaphores[this->currentFrameIndex] };
		std::vector<VkPipelineStageFlags> waitStages = { VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT };

		if (isWaitTransfer) {
			waitSemaphores.emplace_back(this->transferFinishSemaphores[0]);
			waitStages.emplace_back(VK_PIPELINE_STAGE_VERTEX_INPUT_BIT);
		}

		NugieVulkan::CommandBuffer::submitCommands(commandBuffers, this->device->getGraphicsQueue(), waitSemaphores, waitStages, signalSemaphores, this->inFlightFences[this->currentFrameIndex]);
	}

	void Renderer::submitRenderCommand(NugieVulkan::CommandBuffer* commandBuffer, bool isWaitTransfer) {
		assert(this->isFrameStarted && "can't submit command if frame is not in progress");
		vkResetFences(this->device->getLogicalDevice(), 1, &this->inFlightFences[this->currentFrameIndex]);

		std::vector<VkSemaphore> waitSemaphores = { this->imageAvailableSemaphores[this->currentFrameIndex] };
		std::vector<VkSemaphore> signalSemaphores = { this->renderFinishedSemaphores[this->currentFrameIndex] };
		std::vector<VkPipelineStageFlags> waitStages = { VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT };

		if (isWaitTransfer) {
			waitSemaphores.emplace_back(this->transferFinishSemaphores[0]);
			waitStages.emplace_back(VK_PIPELINE_STAGE_VERTEX_INPUT_BIT);
		}

		commandBuffer->submitCommand(this->device->getGraphicsQueue(), waitSemaphores, waitStages, signalSemaphores, this->inFlightFences[this->currentFrameIndex]);
	}

	void Renderer::submitTransferCommand(NugieVulkan::CommandBuffer* commandBuffer) {
		vkResetFences(this->device->getLogicalDevice(), 1, &this->inFlightFences[this->currentFrameIndex]);

		std::vector<VkSemaphore> waitSemaphores = {  };
		std::vector<VkSemaphore> signalSemaphores = { this->transferFinishSemaphores[0] };
		std::vector<VkPipelineStageFlags> waitStages = {  };

		commandBuffer->submitCommand(this->device->getTransferQueue(), waitSemaphores, waitStages, signalSemaphores, this->inFlightFences[this->currentFrameIndex]);
	}

	bool Renderer::presentFrame() {
		assert(this->isFrameStarted && "can't present frame if frame is not in progress");

		std::vector<VkSemaphore> waitSemaphores = {this->renderFinishedSemaphores[this->currentFrameIndex]};
		auto result = this->swapChain->presentRenders(this->device->getPresentQueue(), &this->currentImageIndex, waitSemaphores);

		this->currentFrameIndex = (this->currentFrameIndex + 1) % NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT;
		this->isFrameStarted = false;

		if (result == VK_ERROR_OUT_OF_DATE_KHR || result == VK_SUBOPTIMAL_KHR || this->window->wasResized()) {
			this->window->resetResizedFlag();
			this->recreateSwapChain();
			this->descriptorPool->reset();

			return false;
		} else if (result != VK_SUCCESS) {
			throw std::runtime_error("failed to present swap chain image");
		}

		return true;
	}
}