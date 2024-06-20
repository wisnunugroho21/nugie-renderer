#include "app.hpp"

#include "../utils/load_model/load_model.hpp"

#include "../data/terrain/terrain_generation/fault_terrain_generation.hpp"
#include "../data/terrain/terrain_generation/flat_terrain_generation.hpp"
#include "../data/terrain/terrain_mesh/quads_terrain_mesh.hpp"
#include "../data/skybox/skybox.hpp"

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
    App::App() {
        this->window = new NugieVulkan::Window(WIDTH, HEIGHT, APP_TITLE);
        this->device = new NugieVulkan::Device(this->window);
        this->deviceProcedures = new NugieVulkan::DeviceProcedures(this->device);
        this->renderer = new Renderer(this->window, this->device, NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT);

        this->camera = new Camera();
        this->mouseController = new MouseController();
        this->keyboardController = new KeyboardController();

        this->loadObjects();
        this->init();
        this->recordCommand();
    }

    App::~App() {
        delete this->meshRenderer;        
        delete this->finalSubRenderer;        
        delete this->renderer;
        
        delete this->meshDescSet;
        
        delete this->geometryBuffer;

        delete this->device;
        delete this->window;

        delete this->mouseController;
        delete this->keyboardController;
        delete this->camera;
    }

    void App::recordCommand() {
        uint32_t imageCount = static_cast<uint32_t>(this->renderer->getSwapChain()->getImageCount());

        for (uint32_t imageIndex = 0; imageIndex < imageCount; imageIndex++) {
            for (uint32_t frameIndex = 0; frameIndex < NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT; frameIndex++) {
                auto commandBuffer = this->renderer->beginRecordRenderCommand(frameIndex, imageIndex);

                this->finalSubRenderer->beginRenderPass(commandBuffer, imageIndex);
               
                this->meshRenderer->render(commandBuffer, { this->meshDescSet->getDescriptorSets(frameIndex) });
                
                this->finalSubRenderer->endRenderPass(commandBuffer);

                commandBuffer->endCommand();
            }
        }

        
    }

    void App::renderLoop() {
        //this->renderer->submitPrepareCommand();

        while (this->isRendering) {
            this->frameCount++;

            if (this->renderer->acquireFrame()) {
                uint32_t frameIndex = this->renderer->getFrameIndex();

                if (this->cameraUpdateCount < NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT) {
                    this->cameraUpdateCount++;
                }

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

    void App::run() {
        glm::vec3 cameraPosition;
        glm::vec2 cameraRotation;

        bool isMousePressed = false, isKeyboardPressed = false;

        uint32_t t = 0;

        std::thread renderThread(&App::renderLoop, std::ref(*this));

        auto oldTime = std::chrono::high_resolution_clock::now();
        auto oldFpsTime = std::chrono::high_resolution_clock::now();

        while (!this->window->shouldClose()) {
            this->window->pollEvents();

            cameraPosition = this->camera->getPosition();
            cameraRotation = this->camera->getRotation();

            isMousePressed = false;
            isKeyboardPressed = false;

            auto newTime = std::chrono::high_resolution_clock::now();
            float deltaTime = std::chrono::duration<float, std::chrono::seconds::period>(newTime - oldTime).count();
            oldTime = newTime;

            cameraRotation = this->mouseController->rotateInPlaceXZ(this->window->getWindow(), deltaTime, cameraRotation, &isMousePressed);
            cameraPosition = this->keyboardController->moveInPlaceXZ(this->window->getWindow(), deltaTime, cameraPosition, this->camera->getDirection(), &isKeyboardPressed);

            if (isMousePressed || isKeyboardPressed) {
                this->camera->setViewYXZ(cameraPosition, cameraRotation);

                this->cameraUpdateCount = 0u;
            }

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

    void App::loadObjects() {
        std::vector<Vertex> vertices;
        std::vector<Primitive> primitives;

        vertices.emplace_back(Vertex{ glm::vec4{ -0.5, -0.5, -0.5, 1.0 } });
        vertices.emplace_back(Vertex{ glm::vec4{ -0.5, -0.5, 0.5, 1.0 } });
        vertices.emplace_back(Vertex{ glm::vec4{ -0.5, 0.5, -0.5, 1.0 } });
        vertices.emplace_back(Vertex{ glm::vec4{ -0.5, 0.5, 0.5, 1.0 } });
        vertices.emplace_back(Vertex{ glm::vec4{ 0.5, -0.5, -0.5, 1.0 } });
        vertices.emplace_back(Vertex{ glm::vec4{ 0.5, -0.5, 0.5, 1.0 } });
        vertices.emplace_back(Vertex{ glm::vec4{ 0.5, 0.5, -0.5, 1.0 } });
        vertices.emplace_back(Vertex{ glm::vec4{ 0.5, 0.5, 0.5, 1.0 } });

        primitives.emplace_back(Primitive{ glm::uvec4{ 0, 2, 1, 0 } });
        primitives.emplace_back(Primitive{ glm::uvec4{ 1, 2, 3, 0 } });
        primitives.emplace_back(Primitive{ glm::uvec4{ 4, 5, 6, 0 } });
        primitives.emplace_back(Primitive{ glm::uvec4{ 5, 7, 6, 0 } });
        primitives.emplace_back(Primitive{ glm::uvec4{ 0, 1, 5, 0 } });
        primitives.emplace_back(Primitive{ glm::uvec4{ 0, 5, 4, 0 } });
        primitives.emplace_back(Primitive{ glm::uvec4{ 2, 6, 7, 0 } });
        primitives.emplace_back(Primitive{ glm::uvec4{ 2, 7, 3, 0 } });
        primitives.emplace_back(Primitive{ glm::uvec4{ 0, 4, 6, 0 } });
        primitives.emplace_back(Primitive{ glm::uvec4{ 0, 6, 2, 0 } });
        primitives.emplace_back(Primitive{ glm::uvec4{ 1, 3, 7, 0 } });
        primitives.emplace_back(Primitive{ glm::uvec4{ 1, 7, 5, 0 } });

        // ----------------------------------------------------------------------------

        this->geometryBuffer = StackedArrayBuffer::Builder(this->device, 
                                                            VK_BUFFER_USAGE_STORAGE_BUFFER_BIT | VK_BUFFER_USAGE_TRANSFER_DST_BIT, 
                                                            true)
                .addArrayItem("vertices", static_cast<VkDeviceSize>(sizeof(Vertex)), static_cast<uint32_t>(vertices.size()))
                .addArrayItem("primitives", static_cast<VkDeviceSize>(sizeof(Primitive)), static_cast<uint32_t>(primitives.size()))
                .build();

        auto commandBuffer = this->renderer->beginRecordTransferCommand();

        this->geometryBuffer->replaceValue(commandBuffer, "vertices", vertices.data());
        this->geometryBuffer->replaceValue(commandBuffer, "primitives", primitives.data());

        commandBuffer->endCommand();
        this->renderer->submitTransferCommand();
    }

    void App::initCamera(uint32_t width, uint32_t height) {
        glm::vec3 position = glm::vec3(80.0f, 110.0f, 80.0f);
        glm::vec3 target = glm::vec3(400.0f, 110.0f, 400.0f);

        float near = 0.1f;
        float far = 2000.0f;

        float theta = glm::radians(45.0f);
        float aspectRatio = static_cast<float>(width) / static_cast<float>(height);

        this->camera->setPerspectiveProjection(theta, aspectRatio, near, far);
        this->camera->setViewTarget(position, target);

        glm::mat4 view = this->camera->getViewMatrix();
        glm::mat4 projection = this->camera->getProjectionMatrix();

        /* this->renderData.cameraTransformation.projection = projection;
        this->renderData.cameraTransformation.view = view;

        this->renderData.tessellationData.tessellationScreenSizeFactorEdgeSize = glm::vec4{width, height, 1.0f, 32};
        this->renderData.fragmentData.origin = glm::vec4(position, 1.0f);

        this->renderData.fragmentData.sunLight.direction = glm::normalize(glm::vec4(0.0f, -1.0f, 0.0f, 0.0f));
        this->renderData.fragmentData.sunLight.color = glm::vec4(3.0f, 3.0f, 3.0f, 1.0f); */
    }

    void App::init() {
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

        this->meshDescSet = DescriptorSet::Builder(this->device, this->renderer->getDescriptorPool(), NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT)
                                .addBuffer(0, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_MESH_BIT_EXT, this->geometryBuffer->getInfo("vertices"))
                                .addBuffer(1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_MESH_BIT_EXT, this->geometryBuffer->getInfo("primitives"))
                                .build();

        this->meshRenderer = new MeshRenderSystem(this->device, this->finalSubRenderer->getRenderPass(), "shader/simple.task.spv", 
                                                  "shader/buffer_cube.mesh.spv", "shader/mesh_shade.frag.spv", this->deviceProcedures,
                                                  { this->meshDescSet->getDescSetLayout() });

        this->meshRenderer->initialize();
    }

    void App::resize() {
        uint32_t width = this->renderer->getSwapChain()->getWidth();
        uint32_t height = this->renderer->getSwapChain()->getHeight();
        uint32_t imageCount = static_cast<uint32_t>(this->renderer->getSwapChain()->getImageCount());
        VkSampleCountFlagBits msaaSample = this->device->getMSAASamples();

        this->renderer->resetCommandPool();

        SubRenderer::Overwriter(this->device, width, height, imageCount)
            .addOutsideAttachment(this->renderer->getSwapChain()->getswapChainImages())
            .overwrite(this->finalSubRenderer);

        float aspectRatio = static_cast<float>(width) / static_cast<float>(height);
        this->camera->setAspect(aspectRatio);

        this->cameraUpdateCount = 0u;

        this->recordCommand();
    }
}