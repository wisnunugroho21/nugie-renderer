#include "mesh_shading_app.hpp"

#define GLM_FORCE_RADIANS
#define GLM_FORCE_DEPTH_ZERO_TO_ONE
#include <glm/glm.hpp>
#include <glm/gtc/constants.hpp>

#include <stdexcept>
#include <array>
#include <string>
#include <chrono>
#include <iostream>
#include <cstdlib>

#include <thread>

namespace NugieApp
{
    MeshShadingApp::MeshShadingApp() {
        this->window = new NugieVulkan::Window(WIDTH, HEIGHT, APP_TITLE);
        this->device = new NugieVulkan::Device(this->window);        
        this->renderer = new Renderer(this->window, this->device, NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT);
        this->deviceProcedures = new NugieVulkan::DeviceProcedures(this->device);

        this->loadObjects();
        this->init();
        this->recordCommand();
    }

    MeshShadingApp::~MeshShadingApp() {
        delete this->meshRenderer;        
        delete this->finalSubRenderer;        
        delete this->renderer;

        delete this->device;
        delete this->window;
    }

    void MeshShadingApp::recordCommand() {
        uint32_t imageCount = static_cast<uint32_t>(this->renderer->getSwapChain()->getImageCount());

        for (uint32_t imageIndex = 0; imageIndex < imageCount; imageIndex++) {
            for (uint32_t frameIndex = 0; frameIndex < NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT; frameIndex++) {
                auto commandBuffer = this->renderer->beginRecordRenderCommand(frameIndex, imageIndex);

                this->finalSubRenderer->beginRenderPass(commandBuffer, imageIndex);
               
                this->meshRenderer->render(commandBuffer, 1u, 1u, 1u);
                
                this->finalSubRenderer->endRenderPass(commandBuffer);

                commandBuffer->endCommand();
            }
        }        
    }

    void MeshShadingApp::renderLoop() {
        while (this->isRendering) {
            this->frameCount++;

            if (this->renderer->acquireFrame()) {
                uint32_t frameIndex = this->renderer->getFrameIndex();

                this->renderer->submitRenderCommand();

                if (!this->renderer->presentFrame()) {
                    this->resize();
                    this->randomSeed = 0;

                    continue;
                }

                if (frameIndex + 1 == NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT) {
                    this->randomSeed++;
                }
            }
        }
    }

    void MeshShadingApp::run() {
        glm::vec3 cameraPosition;
        glm::vec2 cameraRotation;

        bool isMousePressed = false, isKeyboardPressed = false;

        uint32_t t = 0;

        std::thread renderThread(&MeshShadingApp::renderLoop, std::ref(*this));

        auto oldTime = std::chrono::high_resolution_clock::now();
        auto oldFpsTime = std::chrono::high_resolution_clock::now();

        while (!this->window->shouldClose()) {
            this->window->pollEvents();

            auto newTime = std::chrono::high_resolution_clock::now();
            float deltaTime = std::chrono::duration<float, std::chrono::seconds::period>(newTime - oldTime).count();
            oldTime = newTime;

            if (t > 1000 && this->frameCount > 0) {
                newTime = std::chrono::high_resolution_clock::now();
                deltaTime = std::chrono::duration<float, std::chrono::seconds::period>(newTime - oldFpsTime).count();
                oldFpsTime = newTime;

                std::string appTitle = std::string(APP_TITLE) + std::string(" | FPS: ") + std::to_string((this->frameCount / deltaTime));
                glfwSetWindowTitle(this->window->getWindow(), appTitle.c_str());

                this->frameCount = 0;
                t = 0;
            } else {
                t++;
            }
        }

        this->isRendering = false;
        renderThread.join();

        vkDeviceWaitIdle(this->device->getLogicalDevice());
    }

    void MeshShadingApp::loadObjects() {
        
    }

    void MeshShadingApp::initCamera(uint32_t width, uint32_t height) {
        
    }

    void MeshShadingApp::init() {
        uint32_t width = this->renderer->getSwapChain()->getWidth();
        uint32_t height = this->renderer->getSwapChain()->getHeight();
        uint32_t imageCount = static_cast<uint32_t>(this->renderer->getSwapChain()->getImageCount());
        VkSampleCountFlagBits msaaSample = this->device->getMSAASamples();

        this->initCamera(width, height);

        this->finalSubRenderer = SubRenderer::Builder(this->device, width, height, imageCount)
                                     .addAttachment(AttachmentType::KEEPED, this->renderer->getSwapChain()->getSwapChainImageFormat(),
                                                    VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL, msaaSample)
                                     .setDepthAttachment(AttachmentType::KEEPED, VK_FORMAT_D16_UNORM,
                                                         VK_IMAGE_LAYOUT_DEPTH_STENCIL_ATTACHMENT_OPTIMAL, msaaSample)
                                     .addResolvedAttachment(this->renderer->getSwapChain()->getswapChainImages(), AttachmentType::OUTPUT_STORED,
                                                            this->renderer->getSwapChain()->getSwapChainImageFormat(), VK_IMAGE_LAYOUT_PRESENT_SRC_KHR)
                                     .build();
        
        this->meshRenderer = new MeshRenderSystem(this->device, this->finalSubRenderer->getRenderPass(), 
                                                  "shader/simple.task.spv", "shader/tessellation_cube.mesh.spv", 
                                                  "shader/mesh_shade.frag.spv", this->deviceProcedures);

        this->meshRenderer->initialize();
    }

    void MeshShadingApp::resize() {
        uint32_t width = this->renderer->getSwapChain()->getWidth();
        uint32_t height = this->renderer->getSwapChain()->getHeight();
        uint32_t imageCount = static_cast<uint32_t>(this->renderer->getSwapChain()->getImageCount());
        VkSampleCountFlagBits msaaSample = this->device->getMSAASamples();

        this->renderer->resetCommandPool();

        SubRenderer::Overwriter(this->device, width, height, imageCount)
            .addOutsideAttachment(this->renderer->getSwapChain()->getswapChainImages())
            .overwrite(this->finalSubRenderer);

        this->recordCommand();
    }
}