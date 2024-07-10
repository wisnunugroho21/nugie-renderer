#pragma once

#include "../../vulkan/window/window.hpp"
#include "../../vulkan/device/device.hpp"
#include "../../vulkan/swap_chain/swap_chain.hpp"
#include "../../vulkan/buffer/buffer.hpp"
#include "../../vulkan/descriptor/descriptor_pool.hpp"
#include "../../vulkan/command/command_buffer.hpp"

#include <memory>
#include <vector>
#include <cassert>

namespace NugieApp {
    class Renderer {
    public:
        Renderer(NugieVulkan::Window *window, NugieVulkan::Device *device, uint32_t frameCount);

        ~Renderer();

        NugieVulkan::SwapChain *getSwapChain() const { return this->swapChain; }

        NugieVulkan::DescriptorPool *getDescriptorPool() const { return this->descriptorPool; }

        bool isFrameInProgress() const { return this->isFrameStarted; }

        uint32_t getFrameIndex() const {
            assert(this->isFrameStarted && "cannot get frame index when frame is not in progress");
            return this->currentFrameIndex;
        }

        uint32_t getImageIndex() const {
            assert(this->isFrameStarted && "cannot get image index when frame is not in progress");
            return this->currentImageIndex;
        }

        void resetCommandPool();

        NugieVulkan::CommandBuffer *beginRecordRenderCommand(uint32_t frameIndex, uint32_t imageIndex);

        NugieVulkan::CommandBuffer *beginRecordTransferCommand();

        void submitRenderCommand();

        void submitTransferCommand();

        bool acquireFrame();

        bool presentFrame();

    private:
        void recreateSwapChain();

        void createSyncObjects();

        void createDescriptorPool();

        void createCommandPool();

        void createCommandBuffers();

        NugieVulkan::Window *window;
        NugieVulkan::Device *device;

        NugieVulkan::DescriptorPool *descriptorPool = nullptr;
        NugieVulkan::SwapChain *swapChain = nullptr;

        NugieVulkan::CommandPool *graphicCommandPool = nullptr;
        NugieVulkan::CommandPool *transferCommandPool = nullptr;

        std::vector<NugieVulkan::CommandBuffer *> graphicCommandBuffers;
        std::vector<NugieVulkan::CommandBuffer *> transferCommandBuffers;

        std::vector<VkFence> inFlightFences, imagesInFlights;
        std::vector<VkSemaphore> imageAvailableSemaphores, renderFinishedSemaphores;
        std::vector<VkSemaphore> transferFinishedSemaphores;

        uint32_t currentImageIndex = 0, currentFrameIndex = 0, imageCount = 0, frameCount = 0;
        bool isFrameStarted = false;

        std::vector<bool> isTransferStarteds;
    };
}