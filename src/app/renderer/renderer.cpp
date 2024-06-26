#include "renderer.hpp"

#include <stdexcept>
#include <array>
#include <string>
#include <cassert>

namespace NugieApp {
    Renderer::Renderer(NugieVulkan::Window *window, NugieVulkan::Device *device, uint32_t frameCount) 
                        : device{device}, window{window}, frameCount{frameCount} 
    {
        this->recreateSwapChain();
        this->imageCount = this->swapChain->getImageCount();

        this->createSyncObjects();
        this->createDescriptorPool();
        this->createCommandPool();
        this->createCommandBuffers();
    }

    Renderer::~Renderer() {
        for (uint32_t i = 0; i < this->frameCount; i++) {
            vkDestroySemaphore(this->device->getLogicalDevice(), this->renderFinishedSemaphores[i], nullptr);
            vkDestroySemaphore(this->device->getLogicalDevice(), this->imageAvailableSemaphores[i], nullptr);
            vkDestroyFence(this->device->getLogicalDevice(), this->inFlightFences[i], nullptr);

            delete this->graphicCommandBuffers[i];
        }

        for (auto &&transferFinishedSemaphore : this->transferFinishedSemaphores) {
            vkDestroySemaphore(this->device->getLogicalDevice(), transferFinishedSemaphore, nullptr);
        }        

        delete this->transferCommandBuffers[0];

        delete this->graphicCommandPool;
        delete this->transferCommandPool;

        delete this->descriptorPool;
        delete this->swapChain;
    }

    void Renderer::recreateSwapChain() {
        auto extent = this->window->getExtent();
        while (extent.width == 0 || extent.height == 0) {
            extent = this->window->getExtent();
            glfwWaitEvents();
        }

        vkDeviceWaitIdle(this->device->getLogicalDevice());

        if (this->swapChain == nullptr) {
            this->swapChain = NugieVulkan::SwapChain::Builder(this->device, 
                                                              this->window->getSurface(), 
                                                              extent.width, extent.height)
                    .setDefault()
                    .build();
        } else {
            auto oldSwapChain = std::move(this->swapChain);
            this->swapChain = NugieVulkan::SwapChain::Builder(this->device, 
                                                              this->window->getSurface(), 
                                                              extent.width, extent.height)
                    .setDefault()
                    .setOldSwapChain(oldSwapChain)
                    .build();

            if (!oldSwapChain->compareSwapFormat(this->swapChain)) {
                throw std::runtime_error("Swap chain image has changed");
            }
        }
    }

    void Renderer::createDescriptorPool() {
        this->descriptorPool =
                NugieVulkan::DescriptorPool::Builder(this->device)
                        .setMaxSets(100)
                        .setPoolFlags(VK_DESCRIPTOR_POOL_CREATE_FREE_DESCRIPTOR_SET_BIT)
                        .addPoolSize(VK_DESCRIPTOR_TYPE_STORAGE_IMAGE, 50)
                        .addPoolSize(VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, 50)
                        .addPoolSize(VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER, 50)
                        .addPoolSize(VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 150)
                        .build();
    }

    void Renderer::createCommandPool() {
        auto queueFamily = this->device->getPhysicalQueueFamilies();
        this->graphicCommandPool = new NugieVulkan::CommandPool(
                this->device,
                queueFamily.graphicsFamily
        );

        this->transferCommandPool = new NugieVulkan::CommandPool(
                this->device,
                queueFamily.transferFamily
        );
    }

    void Renderer::createSyncObjects() {
        this->imageAvailableSemaphores.resize(this->frameCount);
        this->renderFinishedSemaphores.resize(this->frameCount);
        this->inFlightFences.resize(this->frameCount);
        this->imagesInFlights.resize(this->imageCount, VK_NULL_HANDLE);

        this->transferFinishedSemaphores.resize(this->frameCount);

        VkSemaphoreCreateInfo semaphoreInfo = {};
        semaphoreInfo.sType = VK_STRUCTURE_TYPE_SEMAPHORE_CREATE_INFO;

        VkFenceCreateInfo fenceInfo = {};
        fenceInfo.sType = VK_STRUCTURE_TYPE_FENCE_CREATE_INFO;
        fenceInfo.flags = VK_FENCE_CREATE_SIGNALED_BIT;

        for (uint32_t i = 0; i < this->frameCount; i++) {
            if (vkCreateSemaphore(this->device->getLogicalDevice(), &semaphoreInfo, nullptr,
                                  &this->imageAvailableSemaphores[i]) != VK_SUCCESS ||
                vkCreateSemaphore(this->device->getLogicalDevice(), &semaphoreInfo, nullptr,
                                  &this->renderFinishedSemaphores[i]) != VK_SUCCESS ||
                vkCreateFence(this->device->getLogicalDevice(), &fenceInfo, nullptr, &this->inFlightFences[i]) !=
                VK_SUCCESS) {
                throw std::runtime_error("failed to create synchronization objects for a frame!");
            }
        }

        for (uint32_t i = 0; i < this->frameCount; i++) {
            if (vkCreateSemaphore(this->device->getLogicalDevice(), &semaphoreInfo, nullptr,
                                  &this->transferFinishedSemaphores[i]) != VK_SUCCESS) {
                throw std::runtime_error("failed to create synchronization objects for transfer operation!");
            }
        }

        this->isTransferStarteds.resize(this->frameCount, false);
    }

    void Renderer::createCommandBuffers() {
        std::vector<VkCommandBuffer> commandBuffers;
        commandBuffers.resize(this->imageCount * this->frameCount);

        this->graphicCommandPool->allocate(commandBuffers);
        this->graphicCommandBuffers.clear();

        for (uint32_t i = 0; i < this->imageCount * this->frameCount; i++) {
            this->graphicCommandBuffers.emplace_back(new NugieVulkan::CommandBuffer(this->device, commandBuffers[i]));
        }

        VkCommandBuffer transferCommandBuffer;
        this->transferCommandPool->allocate(&transferCommandBuffer);

        this->transferCommandBuffers.clear();
        this->transferCommandBuffers.emplace_back(new NugieVulkan::CommandBuffer(this->device, transferCommandBuffer));
    }

    void Renderer::resetCommandPool() {
        this->transferCommandPool->reset();
        this->graphicCommandPool->reset();
    }

    bool Renderer::acquireFrame() {
        assert(!this->isFrameStarted && "can't acquire frame while frame still in progress");

        vkWaitForFences(
                this->device->getLogicalDevice(),
                1,
                &this->inFlightFences[this->currentFrameIndex],
                VK_TRUE,
                std::numeric_limits<uint64_t>::max()
        );

        auto result = this->swapChain->acquireNextImage(&this->currentImageIndex,
                                                        this->imageAvailableSemaphores[this->currentFrameIndex]);

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

    NugieVulkan::CommandBuffer *Renderer::beginRecordRenderCommand(uint32_t frameIndex, uint32_t imageIndex) {
        uint32_t commandIndex = frameIndex + this->frameCount * imageIndex;

        this->graphicCommandBuffers[commandIndex]->beginReccuringCommand();
        return this->graphicCommandBuffers[commandIndex];
    }

    NugieVulkan::CommandBuffer *Renderer::beginRecordTransferCommand() {
        this->transferCommandBuffers[0]->beginReccuringCommand();
        return this->transferCommandBuffers[0];
    }

    void Renderer::submitRenderCommand() {
        assert(this->isFrameStarted && "can't submit command if frame is not in progress");

        if (this->imagesInFlights[this->currentImageIndex] != VK_NULL_HANDLE) {
            vkWaitForFences(
                    this->device->getLogicalDevice(),
                    1,
                    &this->imagesInFlights[this->currentImageIndex],
                    VK_TRUE,
                    std::numeric_limits<uint64_t>::max()
            );
        }

        this->imagesInFlights[this->currentImageIndex] = this->inFlightFences[this->currentFrameIndex];
        uint32_t commandIndex = this->currentFrameIndex + this->frameCount * this->currentImageIndex;

        std::vector<VkSemaphore> waitSemaphores = {this->imageAvailableSemaphores[this->currentFrameIndex]};
        std::vector<VkSemaphore> signalSemaphores = {this->renderFinishedSemaphores[this->currentFrameIndex]};
        std::vector<VkPipelineStageFlags> waitStages = {VK_PIPELINE_STAGE_TRANSFER_BIT};

        if (this->isTransferStarteds[this->currentFrameIndex]) {
            waitSemaphores.emplace_back(this->transferFinishedSemaphores[this->currentFrameIndex]);
            waitStages.emplace_back(VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT);

            this->isTransferStarteds[this->currentFrameIndex] = false;
        }

        vkResetFences(this->device->getLogicalDevice(), 1, &this->inFlightFences[this->currentFrameIndex]);
        this->graphicCommandBuffers[commandIndex]->submitCommand(this->device->getGraphicsQueue(),
                                                                 waitSemaphores, waitStages, signalSemaphores,
                                                                 this->inFlightFences[this->currentFrameIndex]);
    }

    void Renderer::submitTransferCommand() {
        std::vector<VkSemaphore> waitSemaphores = {};
        std::vector<VkSemaphore> signalSemaphores = this->transferFinishedSemaphores;
        std::vector<VkPipelineStageFlags> waitStages = {};

        this->transferCommandBuffers[0]->submitCommand(this->device->getTransferQueue(),
                                                       waitSemaphores, waitStages, signalSemaphores);

        for (auto &&isTransferStarted: this->isTransferStarteds) {
            isTransferStarted = true;
        }
    }

    bool Renderer::presentFrame() {
        assert(this->isFrameStarted && "can't present frame if frame is not in progress");

        std::vector<VkSemaphore> waitSemaphores = {this->renderFinishedSemaphores[this->currentFrameIndex]};
        auto result = this->swapChain->presentRenders(this->device->getPresentQueue(), &this->currentImageIndex,
                                                      waitSemaphores);

        this->currentFrameIndex = (this->currentFrameIndex + 1) % this->frameCount;
        this->isFrameStarted = false;

        if (result == VK_ERROR_OUT_OF_DATE_KHR || result == VK_SUBOPTIMAL_KHR || this->window->wasResized()) {
            this->window->resetResizedFlag();
            this->recreateSwapChain();

            return false;
        } else if (result != VK_SUCCESS) {
            throw std::runtime_error("failed to present swap chain image");
        }

        return true;
    }
}