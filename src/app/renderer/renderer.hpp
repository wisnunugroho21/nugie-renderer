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
#include <map>
#include <string>

namespace NugieApp {
    class Renderer {
    public:
        class Builder {
        public:
            Builder(NugieVulkan::Window *window, NugieVulkan::Device *device, uint32_t frameCount);

            Builder &setRenderCommandCount(uint32_t commandCount);

            Builder &setRenderSemaphore(uint32_t semaphoreCount);

            Renderer *build();

        private:
            NugieVulkan::Window *window;
            NugieVulkan::Device *device;

            uint32_t frameCount, renderCommandCount = 0, 
                transferCommandCount = 0, semaphoreCount = 0;
        };

        Renderer(NugieVulkan::Window *window, NugieVulkan::Device *device, uint32_t frameCount, 
                 uint32_t renderCommandCount, uint32_t semaphoreCount);

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

        NugieVulkan::CommandBuffer *beginRecordRenderCommand(uint32_t frameIndex, uint32_t imageIndex, uint32_t commandIndex);

        NugieVulkan::CommandBuffer *beginRecordTransferCommand();

        void submitRenderCommand(uint32_t commandIndex, uint32_t waitSemaphoreIndex = 0, uint32_t signalSemaphoreIndex = 0, VkPipelineStageFlags waitStage = VK_PIPELINE_STAGE_TOP_OF_PIPE_BIT);

        void submitTransferCommand();

        bool acquireFrame();

        bool presentFrame();

    private:
        void recreateSwapChain();

        void createFences();

        void createSemaphores(uint32_t semaphoreCount);

        void createDescriptorPool();

        void createCommandPool();

        void createCommandBuffers();

        NugieVulkan::Window *window;
        NugieVulkan::Device *device;

        NugieVulkan::DescriptorPool *descriptorPool = nullptr;
        NugieVulkan::SwapChain *swapChain = nullptr;

        NugieVulkan::CommandPool *graphicCommandPool = nullptr, *transferCommandPool = nullptr;
        std::vector<NugieVulkan::CommandBuffer *> graphicCommandBuffers, transferCommandBuffers;

        std::vector<VkFence> inFlightFences, imagesInFlights;
        std::vector<VkSemaphore> imageAvailableSemaphores, renderFinishedSemaphores, 
            transferFinishedSemaphores;

        std::vector<VkSemaphore> renderSemaphores;

        uint32_t currentImageIndex = 0, currentFrameIndex = 0, imageCount = 0, 
            frameCount = 0, renderCommandCount = 0;

        bool isFrameStarted = false;
        std::vector<bool> isTransferStarteds;
    };
}