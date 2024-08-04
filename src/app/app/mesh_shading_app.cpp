#include "mesh_shading_app.hpp"

#include "../data/terrain/terrain_generation/fault_terrain_generation.hpp"

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

        this->camera = new Camera();
        this->mouseController = new MouseController();
        this->keyboardController = new KeyboardController();

        uint32_t width = this->renderer->getSwapChain()->getWidth();
        uint32_t height = this->renderer->getSwapChain()->getHeight();

        this->loadObjects(width, height);
        this->initCamera(width, height);

        this->init();
        this->recordCommand();
    }

    MeshShadingApp::~MeshShadingApp() {
        delete this->meshDescSet;
        delete this->meshUniformBuffer;
        delete this->heightMapTexture;

        delete this->meshRenderer;        
        delete this->finalSubRenderer;        
        delete this->renderer;

        delete this->keyboardController;
        delete this->mouseController;
        delete this->camera;

        delete this->deviceProcedures;
        delete this->device;
        delete this->window;
    }

    void MeshShadingApp::recordCommand() {
        uint32_t imageCount = static_cast<uint32_t>(this->renderer->getSwapChain()->getImageCount());

        for (uint32_t imageIndex = 0; imageIndex < imageCount; imageIndex++) {
            for (uint32_t frameIndex = 0; frameIndex < NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT; frameIndex++) {
                auto commandBuffer = this->renderer->beginRecordRenderCommand(frameIndex, imageIndex);

                this->finalSubRenderer->beginRenderPass(commandBuffer, imageIndex);
               
                this->meshRenderer->render(commandBuffer, 1u, 1u, 1u, { this->meshDescSet->getDescriptorSets(frameIndex) });
                
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

                if (this->cameraUpdateCount < NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT) {
                    this->meshUniformBuffer->writeValue(frameIndex, "camera_transf", &this->cameraMatrix);
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

    void MeshShadingApp::run() {
        glm::vec3 cameraPosition;
        glm::vec2 cameraRotation;

        bool isMousePressed = false, isKeyboardPressed = false;

        std::thread renderThread(&MeshShadingApp::renderLoop, std::ref(*this));

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
                this->camera->setViewYXZ(cameraPosition, cameraRotation, glm::vec3{0.0f, 0.0f, 1.0f});

                this->cameraMatrix.view = this->camera->getViewMatrix();
                this->cameraMatrix.projection = this->camera->getProjectionMatrix();

                this->cameraUpdateCount = 0u;
            }

            newTime = std::chrono::high_resolution_clock::now();
            deltaTime = std::chrono::duration<float, std::chrono::seconds::period>(newTime - oldFpsTime).count();

            if (deltaTime > 1.0f && this->frameCount > 0) {               
                oldFpsTime = newTime;

                std::string appTitle = std::string(APP_TITLE) + std::string(" | FPS: ") + std::to_string((this->frameCount / deltaTime));
                glfwSetWindowTitle(this->window->getWindow(), appTitle.c_str());

                this->frameCount = 0;
            }
        }

        this->isRendering = false;
        renderThread.join();

        vkDeviceWaitIdle(this->device->getLogicalDevice());
    }

    void MeshShadingApp::loadObjects(uint32_t width, uint32_t height) {
        this->meshUniformBuffer = StackedObjectBuffer::Builder(this->device, 
                                                               VK_BUFFER_USAGE_UNIFORM_BUFFER_BIT,
                                                               NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT)
                                        .addArrayItem("terrain_square", static_cast<VkDeviceSize>(sizeof(NugieMeshShading::Square)), 1u)
                                        .addArrayItem("tessellation_data", static_cast<VkDeviceSize>(sizeof(NugieMeshShading::TessellationData)), 1u)
                                        .addArrayItem("camera_transf", static_cast<VkDeviceSize>(sizeof(CameraMatrix)), 1u)
                                        .build();

        uint32_t terrainSize = 1600u;
        uint32_t iterations = 200u;
        float minHeight = 0.0f;
        float maxHeight = 100.0f;
        float filter = 0.8f;

        TerrainPoints *terrainPoints = FaultTerrainGeneration(terrainSize, iterations, minHeight, maxHeight, filter).getTerrainPoints();

        NugieMeshShading::Square terrainSquare { glm::vec2{0.0f}, glm::vec2{1600.0f} };
        NugieMeshShading::TessellationData tessData { glm::vec4{width, height, 1000.0f, 1.0f} };
        
        for (uint32_t frameIndex = 0; frameIndex < NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT; frameIndex++) {
            this->meshUniformBuffer->writeValue(frameIndex, "terrain_square", &terrainSquare);
            this->meshUniformBuffer->writeValue(frameIndex, "tessellation_data", &tessData);
        }

        auto commandBuffer = this->renderer->beginRecordTransferCommand();
        this->heightMapTexture = new HeightMapTexture(this->device, commandBuffer, terrainPoints->getAll());

        commandBuffer->endCommand();
        this->renderer->submitTransferCommand();
    }

    void MeshShadingApp::initCamera(uint32_t width, uint32_t height) {
        glm::vec3 position = glm::vec3(800.0f, 150.0f, 800.0f);
        glm::vec3 target = glm::vec3(800.0f, 0.0f, 1600.0f);

        float near = 0.1f;
        float far = 10000.0f;

        float theta = glm::radians(45.0f);
        float aspectRatio = static_cast<float>(width) / static_cast<float>(height);

        this->camera->setPerspectiveProjection(theta, aspectRatio, near, far);
        this->camera->setViewTarget(position, target, glm::vec3{0.0f, 0.0f, 1.0f});

        glm::mat4 view = this->camera->getViewMatrix();
        glm::mat4 projection = this->camera->getProjectionMatrix();

        this->cameraMatrix.projection = projection;
        this->cameraMatrix.view = view;
    }

    void MeshShadingApp::init() {
        uint32_t width = this->renderer->getSwapChain()->getWidth();
        uint32_t height = this->renderer->getSwapChain()->getHeight();
        uint32_t imageCount = static_cast<uint32_t>(this->renderer->getSwapChain()->getImageCount());
        VkSampleCountFlagBits msaaSample = this->device->getMSAASamples();

        std::vector<VkDescriptorImageInfo> heightMapInfos;
        for (uint32_t frameIndex = 0; frameIndex < NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT; frameIndex++) {
            heightMapInfos.emplace_back(this->heightMapTexture->getDescriptorInfo(VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL));
        }        

        this->meshDescSet = DescriptorSet::Builder(this->device, this->renderer->getDescriptorPool(),
                                                   NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT)
                                .addBuffer(0, VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, VK_SHADER_STAGE_TASK_BIT_EXT,
                                           this->meshUniformBuffer->getInfo("camera_transf"))
                                .addBuffer(1, VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, VK_SHADER_STAGE_TASK_BIT_EXT,
                                           this->meshUniformBuffer->getInfo("terrain_square"))
                                .addBuffer(2, VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, VK_SHADER_STAGE_TASK_BIT_EXT,
                                           this->meshUniformBuffer->getInfo("tessellation_data"))
                                .addImage(3, VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER, VK_SHADER_STAGE_TASK_BIT_EXT, 
                                           heightMapInfos)
                                .addBuffer(4, VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, VK_SHADER_STAGE_MESH_BIT_EXT,
                                           this->meshUniformBuffer->getInfo("camera_transf"))
                                .addBuffer(5, VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, VK_SHADER_STAGE_MESH_BIT_EXT,
                                           this->meshUniformBuffer->getInfo("terrain_square"))
                                .addImage(6, VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER, VK_SHADER_STAGE_MESH_BIT_EXT, 
                                           heightMapInfos)
                                .build();

        if (msaaSample == VK_SAMPLE_COUNT_1_BIT) {
            this->finalSubRenderer = SubRenderer::Builder(this->device, width, height, imageCount)
                                        .addAttachment(this->renderer->getSwapChain()->getImages(), AttachmentType::OUTPUT_STORED, 
                                                       this->renderer->getSwapChain()->getImageFormat(), VK_IMAGE_LAYOUT_PRESENT_SRC_KHR, 
                                                       msaaSample)                                     
                                        .setDepthAttachment(AttachmentType::KEEPED, VK_FORMAT_D16_UNORM,
                                                            VK_IMAGE_LAYOUT_DEPTH_STENCIL_ATTACHMENT_OPTIMAL, msaaSample)
                                        .build();
        } else {
            this->finalSubRenderer = SubRenderer::Builder(this->device, width, height, imageCount)
                                        .addAttachment(AttachmentType::KEEPED, this->renderer->getSwapChain()->getImageFormat(),
                                                       VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL, msaaSample)
                                        .setDepthAttachment(AttachmentType::KEEPED, VK_FORMAT_D16_UNORM,
                                                            VK_IMAGE_LAYOUT_DEPTH_STENCIL_ATTACHMENT_OPTIMAL, msaaSample)
                                        .addResolvedAttachment(this->renderer->getSwapChain()->getImages(), AttachmentType::OUTPUT_STORED,
                                                               this->renderer->getSwapChain()->getImageFormat(), VK_IMAGE_LAYOUT_PRESENT_SRC_KHR)
                                        .build();
        }
        
        this->meshRenderer = new MeshRenderSystem(this->device, this->finalSubRenderer->getRenderPass(), 
                                                  "shader/mesh_terrain_culling_64.task.spv", "shader/mesh_terrain_culling.mesh.spv", 
                                                  "shader/mesh_shade.frag.spv", this->deviceProcedures,
                                                  { this->meshDescSet->getDescSetLayout() });

        this->meshRenderer->initialize();
    }

    void MeshShadingApp::resize() {
        uint32_t width = this->renderer->getSwapChain()->getWidth();
        uint32_t height = this->renderer->getSwapChain()->getHeight();
        uint32_t imageCount = static_cast<uint32_t>(this->renderer->getSwapChain()->getImageCount());
        VkSampleCountFlagBits msaaSample = this->device->getMSAASamples();

        this->renderer->resetCommandPool();

        SubRenderer::Overwriter(this->device, width, height, imageCount)
            .addOutsideAttachment(this->renderer->getSwapChain()->getImages())
            .overwrite(this->finalSubRenderer);

        this->recordCommand();
    }
}