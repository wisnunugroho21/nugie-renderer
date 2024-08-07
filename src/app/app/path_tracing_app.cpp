#include "path_tracing_app.hpp"

#include "../utils/bvh/bvh.hpp"

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

namespace NugieApp {
    PathTracingApp::PathTracingApp() {
        this->window = new NugieVulkan::Window(WIDTH, HEIGHT, APP_TITLE);
        this->device = new NugieVulkan::Device(this->window);
        this->renderer = new Renderer(this->window, this->device, NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT);

        this->camera = new PathTracingCamera(this->renderer->getSwapChain()->getWidth(), 
                                             this->renderer->getSwapChain()->getHeight());

        this->loadData();
        this->init();
        this->recordCommand();
    }

    PathTracingApp::~PathTracingApp() {
        delete this->rayIntersectRenderer;
        delete this->indirectRayGenRenderer;
        delete this->indirectRayHitRenderer;
        delete this->lightRayHitRenderer;
        delete this->missRayRenderer;
        delete this->directRayGenRenderer;
        delete this->directRayHitRenderer;
        delete this->integratorRenderer;
        delete this->samplingRenderer;

#ifdef USE_RASTER
        delete this->finalPassRenderer;
#endif

#ifdef USE_RASTER
        delete this->subRenderer;
#endif

        delete this->renderer;

#ifdef USE_RASTER
        delete this->finalDescSet;
#endif

        delete this->rayIntersectDescSet;
        delete this->indirectRayGenDescSet;
        delete this->indirectRayHitDescSet;
        delete this->lightRayHitDescSet;
        delete this->missRayDescSet;
        delete this->directRayGenDescSet;
        delete this->directRayHitDescSet;
        delete this->integratorDescSet;
        delete this->samplingDescSet;       

        delete this->dataBuffer;
        delete this->rayTraceStorageBuffer;
        delete this->uniformBuffer;

        for (auto &&resultImage: this->resultImages) {
            delete resultImage;
        }

#ifdef USE_RASTER
        delete this->resultSampler;
#endif

        delete this->device;
        delete this->window;
    }

    void PathTracingApp::recordCommand() {
        uint32_t imageCount = this->renderer->getSwapChain()->getImageCount();
        uint32_t height = this->renderer->getSwapChain()->getHeight();
        uint32_t width = this->renderer->getSwapChain()->getWidth();

        for (uint32_t imageIndex = 0; imageIndex < imageCount; imageIndex++) {
            for (uint32_t frameIndex = 0; frameIndex < NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT; frameIndex++) {
                auto commandBuffer = this->renderer->beginRecordRenderCommand(frameIndex, imageIndex);
                auto swapChainImage = this->renderer->getSwapChain()->getImages()[imageIndex];

                // -------------------------------------------------------------------------------------------------------------------

                this->indirectRayGenRenderer->render(commandBuffer, width / 8, height / 4, 1,
                                                     {this->indirectRayGenDescSet->getDescriptorSets(frameIndex)}, {});

                this->rayTraceStorageBuffer->transitionBuffer(commandBuffer, frameIndex, std::vector<std::string>{ 
                                                              "traced_ray_origin", "traced_ray_direction" },
                                                              VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                                                              VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                                                              VK_ACCESS_SHADER_WRITE_BIT, VK_ACCESS_SHADER_READ_BIT);

                // -------------------------------------------------------------------------------------------------------------------

                this->rayIntersectRenderer->render(commandBuffer, width * height / 32, 1, 1,
                                                   {this->rayIntersectDescSet->getDescriptorSets(frameIndex)}, {});

                this->rayTraceStorageBuffer->transitionBuffer(commandBuffer, frameIndex, std::vector<std::string>{ 
                                                              "hit_length", "hit_uv", "hit_geometry_index", 
                                                              "hit_geometry_type_index", "hit_transform_index" },
                                                              VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                                                              VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                                                              VK_ACCESS_SHADER_WRITE_BIT, VK_ACCESS_SHADER_READ_BIT);

                // -------------------------------------------------------------------------------------------------------------------

                this->rayTraceStorageBuffer->transitionBuffer(commandBuffer, frameIndex, std::vector<std::string>{ 
                                                              "scattered_ray_origin", "scattered_ray_direction" },
                                                              VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                                                              VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                                                              VK_ACCESS_SHADER_READ_BIT, VK_ACCESS_SHADER_WRITE_BIT);

                this->indirectRayHitRenderer->render(commandBuffer, width * height / 32, 1, 1,
                                                     {this->indirectRayHitDescSet->getDescriptorSets(frameIndex)}, {});

                this->rayTraceStorageBuffer->transitionBuffer(commandBuffer, frameIndex, std::vector<std::string>{ 
                                                              "scattered_ray_origin", "scattered_ray_direction",
                                                              "direct_origin_illuminate", "direct_normal_material",
                                                              "indirect_radiance_pdf"},
                                                              VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                                                              VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                                                              VK_ACCESS_SHADER_WRITE_BIT, VK_ACCESS_SHADER_READ_BIT);

                // -------------------------------------------------------------------------------------------------------------------

                this->lightRayHitRenderer->render(commandBuffer, width * height / 32, 1, 1,
                                                  {this->lightRayHitDescSet->getDescriptorSets(frameIndex)}, {});
                this->rayTraceStorageBuffer->transitionBuffer(commandBuffer, frameIndex, "light_radiance_illuminate",
                                                              VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                                                              VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                                                              VK_ACCESS_SHADER_WRITE_BIT, VK_ACCESS_SHADER_READ_BIT);

                // -------------------------------------------------------------------------------------------------------------------

                this->missRayRenderer->render(commandBuffer, width * height / 32, 1, 1,
                                              {this->missRayDescSet->getDescriptorSets(frameIndex)}, {});
                this->rayTraceStorageBuffer->transitionBuffer(commandBuffer, frameIndex, "miss_radiance_miss",
                                                              VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                                                              VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                                                              VK_ACCESS_SHADER_WRITE_BIT, VK_ACCESS_SHADER_READ_BIT);

                // -------------------------------------------------------------------------------------------------------------------

                this->rayTraceStorageBuffer->transitionBuffer(commandBuffer, frameIndex, std::vector<std::string>{ 
                                                              "traced_ray_origin", "traced_ray_direction" },
                                                              VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                                                              VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                                                              VK_ACCESS_SHADER_READ_BIT, VK_ACCESS_SHADER_WRITE_BIT);

                this->directRayGenRenderer->render(commandBuffer, width * height / 32, 1, 1,
                                                   {this->directRayGenDescSet->getDescriptorSets(frameIndex)}, {});

                this->rayTraceStorageBuffer->transitionBuffer(commandBuffer, frameIndex, std::vector<std::string>{ 
                                                              "traced_ray_origin", "traced_ray_direction" },
                                                              VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                                                              VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                                                              VK_ACCESS_SHADER_WRITE_BIT, VK_ACCESS_SHADER_READ_BIT);

                // -------------------------------------------------------------------------------------------------------------------

                this->rayTraceStorageBuffer->transitionBuffer(commandBuffer, frameIndex, std::vector<std::string>{ 
                                                              "hit_length", "hit_uv", "hit_geometry_index", 
                                                              "hit_geometry_type_index", "hit_transform_index" },
                                                              VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                                                              VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                                                              VK_ACCESS_SHADER_READ_BIT, VK_ACCESS_SHADER_WRITE_BIT);

                this->rayIntersectRenderer->render(commandBuffer, width * height / 32, 1, 1,
                                                   {this->rayIntersectDescSet->getDescriptorSets(frameIndex)}, {});

                this->rayTraceStorageBuffer->transitionBuffer(commandBuffer, frameIndex, std::vector<std::string>{ 
                                                              "hit_length", "hit_uv", "hit_geometry_index", 
                                                              "hit_geometry_type_index", "hit_transform_index" },
                                                              VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                                                              VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                                                              VK_ACCESS_SHADER_WRITE_BIT, VK_ACCESS_SHADER_READ_BIT);

                // -------------------------------------------------------------------------------------------------------------------

                this->directRayHitRenderer->render(commandBuffer, width * height / 32, 1, 1,
                                                   {this->directRayHitDescSet->getDescriptorSets(frameIndex)}, {});
                this->rayTraceStorageBuffer->transitionBuffer(commandBuffer, frameIndex, "direct_radiance_pdf",
                                                              VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                                                              VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                                                              VK_ACCESS_SHADER_WRITE_BIT, VK_ACCESS_SHADER_READ_BIT);

                // -------------------------------------------------------------------------------------------------------------------

                this->rayTraceStorageBuffer->transitionBuffer(commandBuffer, frameIndex, "integrator_radiance_bounce",
                                                              VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                                                              VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                                                              VK_ACCESS_SHADER_READ_BIT,
                                                              VK_ACCESS_SHADER_READ_BIT | VK_ACCESS_SHADER_WRITE_BIT);
                this->integratorRenderer->render(commandBuffer, width * height / 32, 1, 1,
                                                 {this->integratorDescSet->getDescriptorSets(frameIndex)}, {});
                this->rayTraceStorageBuffer->transitionBuffer(commandBuffer, frameIndex, "integrator_radiance_bounce",
                                                              VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                                                              VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                                                              VK_ACCESS_SHADER_READ_BIT | VK_ACCESS_SHADER_WRITE_BIT,
                                                              VK_ACCESS_SHADER_READ_BIT);

                // -------------------------------------------------------------------------------------------------------------------

                this->samplingRenderer->render(commandBuffer, width / 8, height / 4, 1,
                                               {this->samplingDescSet->getDescriptorSets(frameIndex)}, {});
                
                // -------------------------------------------------------------------------------------------------------------------

#ifdef USE_RASTER
                this->resultImages[frameIndex]->transitionImageLayout(commandBuffer, 
                                                                      VK_IMAGE_LAYOUT_GENERAL,
                                                                      VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL,
                                                                      VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                                                                      VK_PIPELINE_STAGE_FRAGMENT_SHADER_BIT,
                                                                      VK_ACCESS_SHADER_WRITE_BIT,
                                                                      VK_ACCESS_SHADER_READ_BIT);

                this->subRenderer->beginRenderPass(commandBuffer, imageIndex);
                this->finalPassRenderer->render(commandBuffer, 6u, 1u, {this->finalDescSet->getDescriptorSets(frameIndex)});
                this->subRenderer->endRenderPass(commandBuffer);

                this->resultImages[frameIndex]->transitionImageLayout(commandBuffer,
                                                                      VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL,
                                                                      VK_IMAGE_LAYOUT_GENERAL,
                                                                      VK_PIPELINE_STAGE_FRAGMENT_SHADER_BIT,
                                                                      VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                                                                      VK_ACCESS_SHADER_READ_BIT,
                                                                      VK_ACCESS_SHADER_WRITE_BIT);
                
#else
                this->resultImages[frameIndex]->transitionImageLayout(commandBuffer, 
                                                                      VK_IMAGE_LAYOUT_GENERAL,
                                                                      VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL,
                                                                      VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                                                                      VK_PIPELINE_STAGE_TRANSFER_BIT,
                                                                      VK_ACCESS_SHADER_WRITE_BIT,
                                                                      VK_ACCESS_TRANSFER_READ_BIT);
                swapChainImage->transitionImageLayout(commandBuffer, VK_IMAGE_LAYOUT_UNDEFINED,
                                                      VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL,
                                                      VK_PIPELINE_STAGE_TOP_OF_PIPE_BIT, 
                                                      VK_PIPELINE_STAGE_TRANSFER_BIT,
                                                      0, VK_ACCESS_TRANSFER_WRITE_BIT);

                this->resultImages[frameIndex]->copyImageToOther(commandBuffer, swapChainImage);                
                
                this->resultImages[frameIndex]->transitionImageLayout(commandBuffer,
                                                                      VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL,
                                                                      VK_IMAGE_LAYOUT_GENERAL,
                                                                      VK_PIPELINE_STAGE_TRANSFER_BIT,
                                                                      VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                                                                      VK_ACCESS_TRANSFER_READ_BIT,
                                                                      VK_ACCESS_SHADER_WRITE_BIT);
                swapChainImage->transitionImageLayout(commandBuffer, VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL,
                                                      VK_IMAGE_LAYOUT_PRESENT_SRC_KHR, 
                                                      VK_PIPELINE_STAGE_TRANSFER_BIT,
                                                      VK_PIPELINE_STAGE_BOTTOM_OF_PIPE_BIT,
                                                      VK_ACCESS_TRANSFER_WRITE_BIT, 0);
#endif
                // -------------------------------------------------------------------------------------------------------------------

                commandBuffer->endCommand();
            }
        }
    }

    void PathTracingApp::renderLoop() {
        while (this->isRendering) {
            this->frameCount++;

            if (this->renderer->acquireFrame()) {
                uint32_t frameIndex = this->renderer->getFrameIndex();

                this->rayTraceUbo.imgSizeRandomSeedNumLight.z = this->randomSeed;
                this->uniformBuffer->writeValue(frameIndex, "ubo", &this->rayTraceUbo);

                this->renderer->submitRenderCommand();

                if (!this->renderer->presentFrame()) {
                    this->resize();
                    this->randomSeed = 0u;

                    continue;
                }

                if (frameIndex + 1 == NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT) {
                    this->randomSeed++;
                }
            }
        }
    }

    void PathTracingApp::run() {
        glm::vec3 cameraPosition;
        glm::vec2 cameraRotation;

        auto isMousePressed = false, isKeyboardPressed = false;

        std::thread renderThread(&PathTracingApp::renderLoop, std::ref(*this));

        // auto oldTime = std::chrono::high_resolution_clock::now();
        auto oldFpsTime = std::chrono::high_resolution_clock::now();

        while (!this->window->shouldClose()) {
            NugieVulkan::Window::pollEvents();

            /* auto newTime = std::chrono::high_resolution_clock::now();
            float deltaTime = std::chrono::duration<float, std::chrono::seconds::period>(newTime - oldTime).count();
            oldTime = newTime; */

            auto newTime = std::chrono::high_resolution_clock::now();
            auto deltaTime = std::chrono::duration<float, std::chrono::seconds::period>(newTime - oldFpsTime).count();

            if (deltaTime > 1.0f && this->frameCount > 0) {
                oldFpsTime = newTime;

                std::string appTitle = std::string(APP_TITLE) + std::string(" | FPS: ") +
                                       std::to_string((static_cast<float>(this->frameCount) / deltaTime));
                glfwSetWindowTitle(this->window->getWindow(), appTitle.c_str());

                this->frameCount = 0u;
            }
        }

        this->isRendering = false;
        renderThread.join();

        vkDeviceWaitIdle(this->device->getLogicalDevice());
    }

    void PathTracingApp::loadData() {
        uint32_t width = this->renderer->getSwapChain()->getWidth();
        uint32_t height = this->renderer->getSwapChain()->getHeight();

        std::vector<NugiePathTracing::Object> objects;
        std::vector<NugiePathTracing::BvhNode> bvhObjects;
        std::vector<NugiePathTracing::Triangle> triangles;
        std::vector<NugiePathTracing::Triangle> triangleLights;
        std::vector<NugiePathTracing::BvhNode> bvhTriangles;
        std::vector<Vertex> vertices;
        std::vector<Transformation> transforms;
        std::vector<Material> materials;

        std::vector<BoundBox *> objectBoundBoxes;
        std::vector<BoundBox *> triangleBoundBoxes;
        std::vector<NugiePathTracing::Triangle> curTris;
        std::vector<TransformComponent> transformComponents;

        // ----------------------------------------------------------------------------
        // kanan

        vertices.emplace_back(Vertex{glm::vec3{555.0f, 0.0f, 0.0f}});
        vertices.emplace_back(Vertex{glm::vec3{555.0f, 555.0f, 0.0f}});
        vertices.emplace_back(Vertex{glm::vec3{555.0f, 555.0f, 555.0f}});
        vertices.emplace_back(Vertex{glm::vec3{555.0f, 0.0f, 555.0f}});

        curTris.clear();
        curTris.emplace_back(NugiePathTracing::Triangle{glm::uvec4{0u, 1u, 2u, 2u}});
        curTris.emplace_back(NugiePathTracing::Triangle{glm::uvec4{2u, 3u, 0u, 2u}});

        transformComponents.emplace_back(
                TransformComponent{glm::vec3(1.0f, 0.0f, 0.0f), glm::vec3(1.0f), glm::vec3(0.0f)});
        auto transformIndex = static_cast<uint32_t>(transformComponents.size() - 1);

        objects.emplace_back(NugiePathTracing::Object{static_cast<uint32_t>(bvhTriangles.size()), static_cast<uint32_t>(triangles.size()),
                                    transformIndex});
        auto objSize = static_cast<uint32_t>(objects.size());

        objectBoundBoxes.emplace_back(
                new ObjectBoundBox{objSize, objects[objSize - 1u], transformComponents[transformIndex], curTris,
                                   vertices});
        auto boundBoxIndex = static_cast<uint32_t>(objectBoundBoxes.size() - 1);

        triangleBoundBoxes.clear();
        for (uint32_t i = 0; i < static_cast<uint32_t>(curTris.size()); i++) {
            triangleBoundBoxes.emplace_back(new TriangleBoundBox{i + 1, curTris[i], vertices});
        }

        for (auto &&curTri: curTris) {
            triangles.emplace_back(curTri);
        }

        for (auto &&bvhTri: createBvh(triangleBoundBoxes)) {
            bvhTriangles.emplace_back(bvhTri);
        }

        transformComponents[transformIndex].objectMaximum = objectBoundBoxes[boundBoxIndex]->getOriginalMax();
        transformComponents[transformIndex].objectMinimum = objectBoundBoxes[boundBoxIndex]->getOriginalMin();

        // ----------------------------------------------------------------------------
        // kiri

        vertices.emplace_back(Vertex{glm::vec3{0.0f, 0.0f, 0.0f}});
        vertices.emplace_back(Vertex{glm::vec3{0.0f, 555.0f, 0.0f}});
        vertices.emplace_back(Vertex{glm::vec3{0.0f, 555.0f, 555.0f}});
        vertices.emplace_back(Vertex{glm::vec3{0.0f, 0.0f, 555.0f}});

        curTris.clear();
        curTris.emplace_back(NugiePathTracing::Triangle{glm::uvec4{4u, 5u, 6u, 1u}});
        curTris.emplace_back(NugiePathTracing::Triangle{glm::uvec4{6u, 7u, 4u, 1u}});

        transformComponents.emplace_back(TransformComponent{glm::vec3(0.0f), glm::vec3(1.0f), glm::vec3(0.0f)});
        transformIndex = static_cast<uint32_t>(transformComponents.size() - 1);

        objects.emplace_back(NugiePathTracing::Object{static_cast<uint32_t>(bvhTriangles.size()), static_cast<uint32_t>(triangles.size()),
                                    transformIndex});
        objSize = static_cast<uint32_t>(objects.size());

        objectBoundBoxes.emplace_back(
                new ObjectBoundBox{objSize, objects[objSize - 1u], transformComponents[transformIndex], curTris,
                                   vertices});
        boundBoxIndex = static_cast<uint32_t>(objectBoundBoxes.size() - 1);

        triangleBoundBoxes.clear();
        for (uint32_t i = 0; i < static_cast<uint32_t>(curTris.size()); i++) {
            triangleBoundBoxes.emplace_back(new TriangleBoundBox{i + 1, curTris[i], vertices});
        }

        for (auto &&curTri: curTris) {
            triangles.emplace_back(curTri);
        }

        for (auto &&bvhTri: createBvh(triangleBoundBoxes)) {
            bvhTriangles.emplace_back(bvhTri);
        }

        transformComponents[transformIndex].objectMaximum = objectBoundBoxes[boundBoxIndex]->getOriginalMax();
        transformComponents[transformIndex].objectMinimum = objectBoundBoxes[boundBoxIndex]->getOriginalMin();

        // ----------------------------------------------------------------------------
        // bawah

        vertices.emplace_back(Vertex{glm::vec3{0.0f, 0.0f, 0.0f}});
        vertices.emplace_back(Vertex{glm::vec3{555.0f, 0.0f, 0.0f}});
        vertices.emplace_back(Vertex{glm::vec3{555.0f, 0.0f, 555.0f}});
        vertices.emplace_back(Vertex{glm::vec3{0.0f, 0.0f, 555.0f}});

        curTris.clear();
        curTris.emplace_back(NugiePathTracing::Triangle{glm::uvec4{8u, 9u, 10u, 0u}});
        curTris.emplace_back(NugiePathTracing::Triangle{glm::uvec4{10u, 11u, 8u, 0u}});

        transformComponents.emplace_back(TransformComponent{glm::vec3(0.0f), glm::vec3(1.0f), glm::vec3(0.0f)});
        transformIndex = static_cast<uint32_t>(transformComponents.size() - 1);

        objects.emplace_back(NugiePathTracing::Object{static_cast<uint32_t>(bvhTriangles.size()), static_cast<uint32_t>(triangles.size()),
                                    transformIndex});
        objSize = static_cast<uint32_t>(objects.size());

        objectBoundBoxes.emplace_back(
                new ObjectBoundBox{objSize, objects[objSize - 1u], transformComponents[transformIndex], curTris,
                                   vertices});
        boundBoxIndex = static_cast<uint32_t>(objectBoundBoxes.size() - 1);

        triangleBoundBoxes.clear();
        for (uint32_t i = 0; i < static_cast<uint32_t>(curTris.size()); i++) {
            triangleBoundBoxes.emplace_back(new TriangleBoundBox{i + 1, curTris[i], vertices});
        }

        for (auto &&curTri: curTris) {
            triangles.emplace_back(curTri);
        }

        for (auto &&bvhTri: createBvh(triangleBoundBoxes)) {
            bvhTriangles.emplace_back(bvhTri);
        }

        transformComponents[transformIndex].objectMaximum = objectBoundBoxes[boundBoxIndex]->getOriginalMax();
        transformComponents[transformIndex].objectMinimum = objectBoundBoxes[boundBoxIndex]->getOriginalMin();

        // ----------------------------------------------------------------------------
        // atas

        vertices.emplace_back(Vertex{glm::vec3{0.0f, 555.0f, 0.0f}});
        vertices.emplace_back(Vertex{glm::vec3{555.0f, 555.0f, 0.0f}});
        vertices.emplace_back(Vertex{glm::vec3{555.0f, 555.0f, 555.0f}});
        vertices.emplace_back(Vertex{glm::vec3{0.0f, 555.0f, 555.0f}});

        curTris.clear();
        curTris.emplace_back(NugiePathTracing::Triangle{glm::uvec4{12u, 13u, 14u, 0u}});
        curTris.emplace_back(NugiePathTracing::Triangle{glm::uvec4{14u, 15u, 12u, 0u}});

        transformComponents.emplace_back(TransformComponent{glm::vec3(0.0f), glm::vec3(1.0f), glm::vec3(0.0f)});
        transformIndex = static_cast<uint32_t>(transformComponents.size() - 1);

        objects.emplace_back(NugiePathTracing::Object{static_cast<uint32_t>(bvhTriangles.size()), static_cast<uint32_t>(triangles.size()),
                                    transformIndex});
        objSize = static_cast<uint32_t>(objects.size());

        objectBoundBoxes.emplace_back(
                new ObjectBoundBox{objSize, objects[objSize - 1u], transformComponents[transformIndex], curTris,
                                   vertices});
        boundBoxIndex = static_cast<uint32_t>(objectBoundBoxes.size() - 1);

        triangleBoundBoxes.clear();
        for (uint32_t i = 0; i < static_cast<uint32_t>(curTris.size()); i++) {
            triangleBoundBoxes.emplace_back(new TriangleBoundBox{i + 1, curTris[i], vertices});
        }

        for (auto &&curTri: curTris) {
            triangles.emplace_back(curTri);
        }

        for (auto &&bvhTri: createBvh(triangleBoundBoxes)) {
            bvhTriangles.emplace_back(bvhTri);
        }

        transformComponents[transformIndex].objectMaximum = objectBoundBoxes[boundBoxIndex]->getOriginalMax();
        transformComponents[transformIndex].objectMinimum = objectBoundBoxes[boundBoxIndex]->getOriginalMin();

        // ----------------------------------------------------------------------------
        // depan

        vertices.emplace_back(Vertex{glm::vec3{0.0f, 0.0f, 555.0f}});
        vertices.emplace_back(Vertex{glm::vec3{0.0f, 555.0f, 555.0f}});
        vertices.emplace_back(Vertex{glm::vec3{555.0f, 555.0f, 555.0f}});
        vertices.emplace_back(Vertex{glm::vec3{555.0f, 0.0f, 555.0f}});

        curTris.clear();
        curTris.emplace_back(NugiePathTracing::Triangle{glm::uvec4{16u, 17u, 18u, 0u}});
        curTris.emplace_back(NugiePathTracing::Triangle{glm::uvec4{18u, 19u, 16u, 0u}});

        transformComponents.emplace_back(TransformComponent{glm::vec3(0.0f), glm::vec3(1.0f), glm::vec3(0.0f)});
        transformIndex = static_cast<uint32_t>(transformComponents.size() - 1);

        objects.emplace_back(NugiePathTracing::Object{static_cast<uint32_t>(bvhTriangles.size()), static_cast<uint32_t>(triangles.size()),
                                    transformIndex});
        objSize = static_cast<uint32_t>(objects.size());

        objectBoundBoxes.emplace_back(
                new ObjectBoundBox{objSize, objects[objSize - 1u], transformComponents[transformIndex], curTris,
                                   vertices});
        boundBoxIndex = static_cast<uint32_t>(objectBoundBoxes.size() - 1);

        triangleBoundBoxes.clear();
        for (uint32_t i = 0; i < static_cast<uint32_t>(curTris.size()); i++) {
            triangleBoundBoxes.emplace_back(new TriangleBoundBox{i + 1, curTris[i], vertices});
        }

        for (auto &&curTri: curTris) {
            triangles.emplace_back(curTri);
        }

        for (auto &&bvhTri: createBvh(triangleBoundBoxes)) {
            bvhTriangles.emplace_back(bvhTri);
        }

        transformComponents[transformIndex].objectMaximum = objectBoundBoxes[boundBoxIndex]->getOriginalMax();
        transformComponents[transformIndex].objectMinimum = objectBoundBoxes[boundBoxIndex]->getOriginalMin();

        // ----------------------------------------------------------------------------
        // light

        vertices.emplace_back(Vertex{glm::vec3{213.0f, 554.0f, 227.0f}});
        vertices.emplace_back(Vertex{glm::vec3{343.0f, 554.0f, 227.0f}});
        vertices.emplace_back(Vertex{glm::vec3{343.0f, 554.0f, 332.0f}});
        vertices.emplace_back(Vertex{glm::vec3{213.0f, 554.0f, 332.0f}});

        curTris.clear();
        curTris.emplace_back(NugiePathTracing::Triangle{glm::uvec4{20u, 21u, 22u, 3u}});
        curTris.emplace_back(NugiePathTracing::Triangle{glm::uvec4{22u, 23u, 20u, 3u}});

        transformComponents.emplace_back(TransformComponent{glm::vec3(0.0f), glm::vec3(1.0f), glm::vec3(0.0f)});
        transformIndex = static_cast<uint32_t>(transformComponents.size() - 1);

        objects.emplace_back(
                NugiePathTracing::Object{static_cast<uint32_t>(bvhTriangles.size()), static_cast<uint32_t>(triangleLights.size()),
                       transformIndex});
        objSize = static_cast<uint32_t>(objects.size());

        objectBoundBoxes.emplace_back(
                new ObjectBoundBox{objSize, objects[objSize - 1u], transformComponents[transformIndex], curTris,
                                   vertices});
        boundBoxIndex = static_cast<uint32_t>(objectBoundBoxes.size() - 1);

        triangleBoundBoxes.clear();
        for (uint32_t i = 0; i < static_cast<uint32_t>(curTris.size()); i++) {
            triangleBoundBoxes.emplace_back(new TriangleLightBoundBox{i + 1, curTris[i], vertices});
        }

        for (auto &&curTri: curTris) {
            triangleLights.emplace_back(curTri);
        }

        for (auto &&bvhTri: createBvh(triangleBoundBoxes)) {
            bvhTriangles.emplace_back(bvhTri);
        }

        transformComponents[transformIndex].objectMaximum = objectBoundBoxes[boundBoxIndex]->getOriginalMax();
        transformComponents[transformIndex].objectMinimum = objectBoundBoxes[boundBoxIndex]->getOriginalMin();

        // ----------------------------------------------------------------------------

        materials.emplace_back(Material{glm::vec4(0.73f, 0.73f, 0.73f, 1.0f)});
        materials.emplace_back(Material{glm::vec4(0.12f, 0.45f, 0.15f, 1.0f)});
        materials.emplace_back(Material{glm::vec4(0.65f, 0.05f, 0.05f, 1.0f)});
        materials.emplace_back(Material{glm::vec4(100.0f, 100.0f, 100.0f, 1.0f)});

        transforms = ConvertComponentToTransform(transformComponents);
        bvhObjects = createBvh(objectBoundBoxes);

        this->rayTraceUbo.imgSizeRandomSeedNumLight.w = static_cast<uint32_t>(triangleLights.size());
        
        // ----------------------------------------------------------------------------

        std::vector<NugiePathTracing::BvhNodeIndex> objectBvhNodeIndexes;
        std::vector<NugiePathTracing::BvhNodeMaximum> objectBvhNodeMaximums;
        std::vector<NugiePathTracing::BvhNodeMinimum> objectBvhNodeMinimums;

        std::vector<NugiePathTracing::BvhNodeIndex> geometryBvhNodeIndexes;
        std::vector<NugiePathTracing::BvhNodeMaximum> geometryBvhNodeMaximums;
        std::vector<NugiePathTracing::BvhNodeMinimum> geometryBvhNodeMinimums;

        std::vector<glm::mat4> worldToObjectTransformations;
        std::vector<glm::mat4> objectToWorldTransformations;
        
        for (auto &&bvhObject : bvhObjects) {
            objectBvhNodeIndexes.emplace_back(NugiePathTracing::BvhNodeIndex {
                bvhObject.leftNode,
                bvhObject.rightNode,
                bvhObject.objIndex,
                bvhObject.typeIndex
            });
            
            objectBvhNodeMaximums.emplace_back(NugiePathTracing::BvhNodeMaximum {
                bvhObject.maximum
            });

            objectBvhNodeMinimums.emplace_back(NugiePathTracing::BvhNodeMinimum {
                bvhObject.minimum
            });
        }

        for (auto &&bvhTriangle : bvhTriangles) {
            geometryBvhNodeIndexes.emplace_back(NugiePathTracing::BvhNodeIndex {
                bvhTriangle.leftNode,
                bvhTriangle.rightNode,
                bvhTriangle.objIndex,
                bvhTriangle.typeIndex
            });
            
            geometryBvhNodeMaximums.emplace_back(NugiePathTracing::BvhNodeMaximum {
                bvhTriangle.maximum
            });

            geometryBvhNodeMinimums.emplace_back(NugiePathTracing::BvhNodeMinimum {
                bvhTriangle.minimum
            });
        }

        for (auto &&transform : transforms) {
            worldToObjectTransformations.emplace_back(transform.worldToObjectMatrix);
            objectToWorldTransformations.emplace_back(transform.objectToWorldMatrix);
        }

        // ----------------------------------------------------------------------------        

#ifdef USE_RASTER
            VkImageUsageFlags imageUsage = VK_IMAGE_USAGE_STORAGE_BIT | VK_IMAGE_USAGE_SAMPLED_BIT;
#else
            VkImageUsageFlags imageUsage = VK_IMAGE_USAGE_STORAGE_BIT | VK_IMAGE_USAGE_TRANSFER_SRC_BIT;
#endif

        this->resultImages.resize(NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT);
        for (uint32_t i = 0; i < NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT; i++) {
            this->resultImages[i] = new NugieVulkan::Image(this->device, width, height, 1, VK_SAMPLE_COUNT_1_BIT,
                                                           VK_FORMAT_R32G32B32A32_SFLOAT,
                                                           VK_IMAGE_TILING_OPTIMAL,
                                                           imageUsage,
                                                           VMA_MEMORY_USAGE_AUTO,
                                                           VMA_ALLOCATION_CREATE_DEDICATED_MEMORY_BIT,
                                                           VK_IMAGE_ASPECT_COLOR_BIT);
        }

#ifdef USE_RASTER
        this->resultSampler = new NugieVulkan::Sampler(this->device, VK_FILTER_LINEAR, VK_SAMPLER_ADDRESS_MODE_CLAMP_TO_BORDER, 
                                                       VK_TRUE, VK_BORDER_COLOR_FLOAT_OPAQUE_BLACK, VK_COMPARE_OP_NEVER, 
                                                       VK_SAMPLER_MIPMAP_MODE_LINEAR, 1.0f);        
#endif

        this->rayTraceStorageBuffer = StackedArrayManyBuffer::Builder(this->device, 
                                                                      VK_BUFFER_USAGE_STORAGE_BUFFER_BIT | VK_BUFFER_USAGE_TRANSFER_DST_BIT,
                                                                      NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT,
                                                                      false)
                .addArrayItem("traced_ray_origin", static_cast<VkDeviceSize>(sizeof(glm::vec4)), width * height)
                .addArrayItem("traced_ray_direction", static_cast<VkDeviceSize>(sizeof(glm::vec4)), width * height)
                .addArrayItem("hit_length", static_cast<VkDeviceSize>(sizeof(float)), width * height)
                .addArrayItem("hit_uv", static_cast<VkDeviceSize>(sizeof(glm::vec2)), width * height)
                .addArrayItem("hit_geometry_index", static_cast<VkDeviceSize>(sizeof(uint32_t)), width * height)
                .addArrayItem("hit_geometry_type_index", static_cast<VkDeviceSize>(sizeof(uint32_t)), width * height)
                .addArrayItem("hit_transform_index", static_cast<VkDeviceSize>(sizeof(uint32_t)), width * height)
                .addArrayItem("scattered_ray_origin", static_cast<VkDeviceSize>(sizeof(glm::vec4)), width * height)
                .addArrayItem("scattered_ray_direction", static_cast<VkDeviceSize>(sizeof(glm::vec4)), width * height)
                .addArrayItem("direct_origin_illuminate", static_cast<VkDeviceSize>(sizeof(glm::vec4)), width * height)
                .addArrayItem("direct_normal_material", static_cast<VkDeviceSize>(sizeof(glm::vec4)), width * height)
                .addArrayItem("indirect_radiance_pdf", static_cast<VkDeviceSize>(sizeof(glm::vec4)), width * height)
                .addArrayItem("light_radiance_illuminate", static_cast<VkDeviceSize>(sizeof(glm::vec4)), width * height)
                .addArrayItem("miss_radiance_miss", static_cast<VkDeviceSize>(sizeof(glm::vec4)), width * height)
                .addArrayItem("direct_radiance_pdf", static_cast<VkDeviceSize>(sizeof(glm::vec4)), width * height)
                .addArrayItem("integrator_radiance_bounce", static_cast<VkDeviceSize>(sizeof(glm::vec4)), width * height)
                .addArrayItem("integrator_indirect_pdf", static_cast<VkDeviceSize>(sizeof(glm::vec4)), width * height)
                .addArrayItem("sampling_result", static_cast<VkDeviceSize>(sizeof(glm::vec4)), width * height)                
                .build();

        this->uniformBuffer = StackedObjectBuffer::Builder(this->device, 
                                                           VK_BUFFER_USAGE_UNIFORM_BUFFER_BIT,
                                                           NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT)
                .addArrayItem("ubo", static_cast<VkDeviceSize>(sizeof(NugiePathTracing::Ubo)), 1u)
                .build();

        this->dataBuffer = StackedArrayBuffer::Builder(this->device,
                                                       VK_BUFFER_USAGE_STORAGE_BUFFER_BIT | VK_BUFFER_USAGE_TRANSFER_DST_BIT,
                                                       true)
                .addArrayItem("object", static_cast<VkDeviceSize>(sizeof(NugiePathTracing::Object)), static_cast<uint32_t>(objects.size()))
                .addArrayItem("object_bvh_index", static_cast<VkDeviceSize>(sizeof(NugiePathTracing::BvhNodeIndex)), static_cast<uint32_t>(objectBvhNodeIndexes.size()))
                .addArrayItem("object_bvh_maximum", static_cast<VkDeviceSize>(sizeof(NugiePathTracing::BvhNodeMaximum)), static_cast<uint32_t>(objectBvhNodeMaximums.size()))
                .addArrayItem("object_bvh_minimum", static_cast<VkDeviceSize>(sizeof(NugiePathTracing::BvhNodeMinimum)), static_cast<uint32_t>(objectBvhNodeMinimums.size()))
                .addArrayItem("triangle", static_cast<VkDeviceSize>(sizeof(NugiePathTracing::Triangle)), static_cast<uint32_t>(triangles.size()))
                .addArrayItem("triangle_light", static_cast<VkDeviceSize>(sizeof(NugiePathTracing::Triangle)), static_cast<uint32_t>(triangleLights.size()))
                .addArrayItem("geometry_bvh_index", static_cast<VkDeviceSize>(sizeof(NugiePathTracing::BvhNodeIndex)), static_cast<uint32_t>(geometryBvhNodeIndexes.size()))
                .addArrayItem("geometry_bvh_maximum", static_cast<VkDeviceSize>(sizeof(NugiePathTracing::BvhNodeMaximum)), static_cast<uint32_t>(geometryBvhNodeMaximums.size()))
                .addArrayItem("geometry_bvh_minimum", static_cast<VkDeviceSize>(sizeof(NugiePathTracing::BvhNodeMinimum)), static_cast<uint32_t>(geometryBvhNodeMinimums.size()))
                .addArrayItem("vertex", static_cast<VkDeviceSize>(sizeof(Vertex)), static_cast<uint32_t>(vertices.size()))
                .addArrayItem("world_to_object", static_cast<VkDeviceSize>(sizeof(glm::mat4)), static_cast<uint32_t>(worldToObjectTransformations.size()))
                .addArrayItem("object_to_world", static_cast<VkDeviceSize>(sizeof(glm::mat4)), static_cast<uint32_t>(objectToWorldTransformations.size()))
                .addArrayItem("material", static_cast<VkDeviceSize>(sizeof(Material)), static_cast<uint32_t>(materials.size()))
                .build();

        // ----------------------------------------------------------------------------

        auto commandBuffer = this->renderer->beginRecordTransferCommand();
        
        this->dataBuffer->writeValue(commandBuffer, "object", objects.data());
        this->dataBuffer->writeValue(commandBuffer, "object_bvh_index", objectBvhNodeIndexes.data());
        this->dataBuffer->writeValue(commandBuffer, "object_bvh_maximum", objectBvhNodeMaximums.data());
        this->dataBuffer->writeValue(commandBuffer, "object_bvh_minimum", objectBvhNodeMinimums.data());
        this->dataBuffer->writeValue(commandBuffer, "triangle", triangles.data());
        this->dataBuffer->writeValue(commandBuffer, "triangle_light", triangleLights.data());
        this->dataBuffer->writeValue(commandBuffer, "geometry_bvh_index", geometryBvhNodeIndexes.data());
        this->dataBuffer->writeValue(commandBuffer, "geometry_bvh_maximum", geometryBvhNodeMaximums.data());
        this->dataBuffer->writeValue(commandBuffer, "geometry_bvh_minimum", geometryBvhNodeMinimums.data());
        this->dataBuffer->writeValue(commandBuffer, "vertex", vertices.data());
        this->dataBuffer->writeValue(commandBuffer, "world_to_object", worldToObjectTransformations.data());
        this->dataBuffer->writeValue(commandBuffer, "object_to_world", objectToWorldTransformations.data());
        this->dataBuffer->writeValue(commandBuffer, "material", materials.data());

        for (auto &&resultImage: this->resultImages) {
            resultImage->transitionImageLayout(commandBuffer, VK_IMAGE_LAYOUT_UNDEFINED, VK_IMAGE_LAYOUT_GENERAL,
                                               VK_PIPELINE_STAGE_TOP_OF_PIPE_BIT, VK_PIPELINE_STAGE_TOP_OF_PIPE_BIT,
                                               0, 0);
        }

        this->rayTraceStorageBuffer->initializeValue(commandBuffer);

        commandBuffer->endCommand();
        this->renderer->submitTransferCommand();
    }

    void PathTracingApp::initCamera(uint32_t width, uint32_t height) {
        NugiePathTracing::Ubo ubo{};

        float near = 0.1f;
        float far = 2000.0f;

        float theta = glm::radians(40.0f);
        float aspectRatio = static_cast<float>(width) / static_cast<float>(height);

        this->camera->setViewDirection(glm::vec3{278.0f, 278.0f, -800.0f}, glm::vec3{0.0f, 0.0f, 1.0f}, 40.0f);
        CameraRay cameraRay = this->camera->getCameraRay();

        this->rayTraceUbo.origin = cameraRay.origin;
        this->rayTraceUbo.horizontal = cameraRay.horizontal;
        this->rayTraceUbo.vertical = cameraRay.vertical;
        this->rayTraceUbo.lowerLeftCorner = cameraRay.lowerLeftCorner;
        this->rayTraceUbo.imgSizeRandomSeedNumLight.x = width;
        this->rayTraceUbo.imgSizeRandomSeedNumLight.y = height;
    }

    void PathTracingApp::init() {
        uint32_t width = this->renderer->getSwapChain()->getWidth();
        uint32_t height = this->renderer->getSwapChain()->getHeight();

        VkSampleCountFlagBits msaaSample = this->device->getMSAASamples();
        uint32_t imageCount = static_cast<uint32_t>(this->renderer->getSwapChain()->getImageCount());

        this->initCamera(width, height);

        std::vector<VkDescriptorImageInfo> resultImageInfos{NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT};

        for (uint32_t i = 0; i < NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT; i++) {
            resultImageInfos[i] = this->resultImages[i]->getDescriptorInfo(VK_IMAGE_LAYOUT_GENERAL);
        }
    
#ifdef USE_RASTER
        std::vector<VkDescriptorImageInfo> resultSamplerInfos{NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT};

        for (uint32_t i = 0; i < NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT; i++) {
            resultSamplerInfos[i] = this->resultSampler->getDescriptorInfo(this->resultImages[i], VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL);
        }

        this->subRenderer = SubRenderer::Builder(this->device, width, height, imageCount)
            .addAttachment(this->renderer->getSwapChain()->getImages(), 
                           AttachmentType::OUTPUT_STORED, 
                           this->renderer->getSwapChain()->getImageFormat(), 
                           VK_IMAGE_LAYOUT_PRESENT_SRC_KHR, 
                           VK_SAMPLE_COUNT_1_BIT)
			.setDepthAttachment(AttachmentType::KEEPED, VK_FORMAT_D16_UNORM, 
				                VK_IMAGE_LAYOUT_DEPTH_STENCIL_ATTACHMENT_OPTIMAL, 
                                VK_SAMPLE_COUNT_1_BIT)
			.build();
#endif

        this->indirectRayGenDescSet = DescriptorSet::Builder(this->device, this->renderer->getDescriptorPool(),
                                                             NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT)
                .addBuffer(0, VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT,
                           this->uniformBuffer->getInfo("ubo"))
                .addBuffer(1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT,
                           this->rayTraceStorageBuffer->getInfo("traced_ray_origin"))
                .addBuffer(2, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT,
                           this->rayTraceStorageBuffer->getInfo("traced_ray_direction"))
                .addBuffer(3, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT,
                           this->rayTraceStorageBuffer->getInfo("scattered_ray_origin"))
                .addBuffer(4, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT,
                           this->rayTraceStorageBuffer->getInfo("scattered_ray_direction"))
                .addBuffer(5, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT,
                           this->rayTraceStorageBuffer->getInfo("integrator_radiance_bounce"))
                .build();

        this->rayIntersectDescSet = DescriptorSet::Builder(this->device, this->renderer->getDescriptorPool(),
                                                           NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT)
                .addBuffer(0, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT,
                           this->rayTraceStorageBuffer->getInfo("hit_length"))
                .addBuffer(1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT,
                           this->rayTraceStorageBuffer->getInfo("hit_uv"))
                .addBuffer(2, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT,
                           this->rayTraceStorageBuffer->getInfo("hit_geometry_index"))
                .addBuffer(3, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT,
                           this->rayTraceStorageBuffer->getInfo("hit_geometry_type_index"))
                .addBuffer(4, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT,
                           this->rayTraceStorageBuffer->getInfo("hit_transform_index"))
                .addBuffer(5, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT,
                           this->rayTraceStorageBuffer->getInfo("traced_ray_origin"))
                .addBuffer(6, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT,
                           this->rayTraceStorageBuffer->getInfo("traced_ray_direction"))
                .addBuffer(7, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT,
                           this->dataBuffer->getInfo("object_bvh_index"))
                .addBuffer(8, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT,
                           this->dataBuffer->getInfo("object_bvh_maximum"))
                .addBuffer(9, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT,
                           this->dataBuffer->getInfo("object_bvh_minimum"))
                .addBuffer(10, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT,
                           this->dataBuffer->getInfo("object"))
                .addBuffer(11, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT,
                           this->dataBuffer->getInfo("geometry_bvh_index"))
                .addBuffer(12, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT,
                           this->dataBuffer->getInfo("geometry_bvh_maximum"))
                .addBuffer(13, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT,
                           this->dataBuffer->getInfo("geometry_bvh_minimum"))
                .addBuffer(14, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT,
                           this->dataBuffer->getInfo("triangle"))
                .addBuffer(15, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT,
                           this->dataBuffer->getInfo("triangle_light"))
                .addBuffer(16, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT,
                           this->dataBuffer->getInfo("vertex"))
                .addBuffer(17, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT,
                           this->dataBuffer->getInfo("world_to_object"))
                .build();

        this->indirectRayHitDescSet = DescriptorSet::Builder(this->device, this->renderer->getDescriptorPool(),
                                                             NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT)
                .addBuffer(0, VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT,
                           this->uniformBuffer->getInfo("ubo"))
                .addBuffer(1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT,
                           this->rayTraceStorageBuffer->getInfo("indirect_radiance_pdf"))
                .addBuffer(2, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT,
                           this->rayTraceStorageBuffer->getInfo("direct_origin_illuminate"))
                .addBuffer(3, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT,
                           this->rayTraceStorageBuffer->getInfo("direct_normal_material"))
                .addBuffer(4, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT,
                           this->rayTraceStorageBuffer->getInfo("scattered_ray_origin"))
                .addBuffer(5, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT,
                           this->rayTraceStorageBuffer->getInfo("scattered_ray_direction"))
                .addBuffer(6, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT,
                           this->rayTraceStorageBuffer->getInfo("traced_ray_origin"))
                .addBuffer(7, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT,
                           this->rayTraceStorageBuffer->getInfo("traced_ray_direction"))
                .addBuffer(8, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT,
                           this->rayTraceStorageBuffer->getInfo("hit_length"))
                .addBuffer(9, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT,
                           this->rayTraceStorageBuffer->getInfo("hit_uv"))
                .addBuffer(10, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT,
                           this->rayTraceStorageBuffer->getInfo("hit_geometry_index"))
                .addBuffer(11, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT,
                           this->rayTraceStorageBuffer->getInfo("hit_geometry_type_index"))
                .addBuffer(12, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT,
                           this->rayTraceStorageBuffer->getInfo("hit_transform_index"))
                .addBuffer(13, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT,
                           this->dataBuffer->getInfo("triangle"))
                .addBuffer(14, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT,
                           this->dataBuffer->getInfo("vertex"))
                .addBuffer(15, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT,
                           this->dataBuffer->getInfo("material"))
                .addBuffer(16, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT,
                           this->dataBuffer->getInfo("object_to_world"))
                .build();

        this->lightRayHitDescSet = DescriptorSet::Builder(this->device, this->renderer->getDescriptorPool(),
                                                          NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT)
                .addBuffer(0, VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT,
                           this->uniformBuffer->getInfo("ubo"))
                .addBuffer(1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT,
                           this->rayTraceStorageBuffer->getInfo("light_radiance_illuminate"))
                .addBuffer(2, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT,
                           this->rayTraceStorageBuffer->getInfo("hit_length"))
                .addBuffer(3, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT,
                           this->rayTraceStorageBuffer->getInfo("hit_geometry_index"))
                .addBuffer(4, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT,
                           this->rayTraceStorageBuffer->getInfo("hit_geometry_type_index"))
                .addBuffer(5, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT,
                           this->dataBuffer->getInfo("triangle_light"))
                .addBuffer(6, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT,
                           this->dataBuffer->getInfo("material"))
                .build();

        this->missRayDescSet = DescriptorSet::Builder(this->device, this->renderer->getDescriptorPool(),
                                                      NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT)
                .addBuffer(0, VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT,
                           this->uniformBuffer->getInfo("ubo"))
                .addBuffer(1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT,
                           this->rayTraceStorageBuffer->getInfo("miss_radiance_miss"))
                .addBuffer(2, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT,
                           this->rayTraceStorageBuffer->getInfo("hit_length"))
                .build();

        this->directRayGenDescSet = DescriptorSet::Builder(this->device, this->renderer->getDescriptorPool(),
                                                           NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT)
                .addBuffer(0, VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT,
                           this->uniformBuffer->getInfo("ubo"))
                .addBuffer(1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT,
                           this->rayTraceStorageBuffer->getInfo("traced_ray_origin"))
                .addBuffer(2, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT,
                           this->rayTraceStorageBuffer->getInfo("traced_ray_direction"))
                .addBuffer(3, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT,
                           this->rayTraceStorageBuffer->getInfo("direct_origin_illuminate"))
                .addBuffer(4, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT,
                           this->dataBuffer->getInfo("triangle_light"))
                .addBuffer(5, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT,
                           this->dataBuffer->getInfo("vertex"))
                .build();

        this->directRayHitDescSet = DescriptorSet::Builder(this->device, this->renderer->getDescriptorPool(),
                                                           NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT)
                .addBuffer(0, VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT,
                           this->uniformBuffer->getInfo("ubo"))
                .addBuffer(1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT,
                           this->rayTraceStorageBuffer->getInfo("direct_radiance_pdf"))
                .addBuffer(2, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT,
                           this->rayTraceStorageBuffer->getInfo("direct_normal_material"))
                .addBuffer(3, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT,
                           this->rayTraceStorageBuffer->getInfo("traced_ray_origin"))
                .addBuffer(4, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT,
                           this->rayTraceStorageBuffer->getInfo("traced_ray_direction"))
                .addBuffer(5, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT,
                           this->rayTraceStorageBuffer->getInfo("hit_length"))
                .addBuffer(6, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT,
                           this->rayTraceStorageBuffer->getInfo("hit_uv"))
                .addBuffer(7, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT,
                           this->rayTraceStorageBuffer->getInfo("hit_geometry_index"))
                .addBuffer(8, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT,
                           this->rayTraceStorageBuffer->getInfo("hit_geometry_type_index"))
                .addBuffer(9, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT,
                           this->rayTraceStorageBuffer->getInfo("hit_transform_index"))
                .addBuffer(10, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT,
                           this->dataBuffer->getInfo("triangle_light"))
                .addBuffer(11, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT,
                           this->dataBuffer->getInfo("vertex"))
                .addBuffer(12, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT,
                           this->dataBuffer->getInfo("material"))
                .addBuffer(13, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT,
                           this->dataBuffer->getInfo("object_to_world"))
                .build();

        this->integratorDescSet = DescriptorSet::Builder(this->device, this->renderer->getDescriptorPool(),
                                                         NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT)
                .addBuffer(0, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT,
                           this->rayTraceStorageBuffer->getInfo("integrator_radiance_bounce"))
                .addBuffer(1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT,
                           this->rayTraceStorageBuffer->getInfo("integrator_indirect_pdf"))
                .addBuffer(2, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT,
                           this->rayTraceStorageBuffer->getInfo("indirect_radiance_pdf"))
                .addBuffer(3, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT,
                           this->rayTraceStorageBuffer->getInfo("light_radiance_illuminate"))
                .addBuffer(4, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT,
                           this->rayTraceStorageBuffer->getInfo("direct_radiance_pdf"))
                .addBuffer(5, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT,
                           this->rayTraceStorageBuffer->getInfo("miss_radiance_miss"))
                .build();

        this->samplingDescSet = DescriptorSet::Builder(this->device, this->renderer->getDescriptorPool(),
                                                       NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT)
                .addImage(0, VK_DESCRIPTOR_TYPE_STORAGE_IMAGE, VK_SHADER_STAGE_COMPUTE_BIT, resultImageInfos)
                .addBuffer(1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT,
                           this->rayTraceStorageBuffer->getInfo("sampling_result"))
                .addBuffer(2, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT,
                           this->rayTraceStorageBuffer->getInfo("integrator_radiance_bounce"))
                .build();

#ifdef USE_RASTER
        this->finalDescSet = DescriptorSet::Builder(this->device, this->renderer->getDescriptorPool(),
                                                    NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT)
                .addImage(0, VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER, VK_SHADER_STAGE_FRAGMENT_BIT, resultSamplerInfos)
                .build();
#endif

        this->indirectRayGenRenderer = new ComputeRenderSystem(this->device, "../build/shader/indirect_ray_gen.comp.spv",
                                                               {this->indirectRayGenDescSet->getDescSetLayout()});
        this->rayIntersectRenderer = new ComputeRenderSystem(this->device, "../build/shader/ray_intersect.comp.spv",
                                                             {this->rayIntersectDescSet->getDescSetLayout()});
        this->indirectRayHitRenderer = new ComputeRenderSystem(this->device, "../build/shader/indirect_ray_hit.comp.spv",
                                                               {this->indirectRayHitDescSet->getDescSetLayout()});
        this->lightRayHitRenderer = new ComputeRenderSystem(this->device, "../build/shader/light_ray_hit.comp.spv",
                                                            {this->lightRayHitDescSet->getDescSetLayout()});
        this->missRayRenderer = new ComputeRenderSystem(this->device, "../build/shader/ray_miss.comp.spv",
                                                        {this->missRayDescSet->getDescSetLayout()});
        this->directRayGenRenderer = new ComputeRenderSystem(this->device, "../build/shader/direct_ray_gen.comp.spv",
                                                             {this->directRayGenDescSet->getDescSetLayout()});
        this->directRayHitRenderer = new ComputeRenderSystem(this->device, "../build/shader/direct_ray_hit.comp.spv",
                                                             {this->directRayHitDescSet->getDescSetLayout()});
        this->integratorRenderer = new ComputeRenderSystem(this->device, "../build/shader/integrator.comp.spv",
                                                           {this->integratorDescSet->getDescSetLayout()});
        this->samplingRenderer = new ComputeRenderSystem(this->device, "../build/shader/sampling.comp.spv",
                                                         {this->samplingDescSet->getDescSetLayout()});

#ifdef USE_RASTER
        this->finalPassRenderer = new FinalPassRenderSystem(this->device, this->subRenderer->getRenderPass(), 
                                                                "../build/shader/raster/final.vert.spv", "../build/shader/raster/final.frag.spv", 
                                                                {this->finalDescSet->getDescSetLayout()});
#endif

        this->indirectRayGenRenderer->initialize();
        this->rayIntersectRenderer->initialize();
        this->indirectRayHitRenderer->initialize();
        this->lightRayHitRenderer->initialize();
        this->missRayRenderer->initialize();
        this->directRayGenRenderer->initialize();
        this->directRayHitRenderer->initialize();
        this->integratorRenderer->initialize();
        this->samplingRenderer->initialize();

#ifdef USE_RASTER
        this->finalPassRenderer->initialize();
#endif
    }

    void PathTracingApp::resize() {
        uint32_t width = this->renderer->getSwapChain()->getWidth();
        uint32_t height = this->renderer->getSwapChain()->getHeight();
        uint32_t imageCount = this->renderer->getSwapChain()->getImageCount();
        VkSampleCountFlagBits msaaSample = this->device->getMSAASamples();

        this->renderer->resetCommandPool();
        this->recordCommand();
    }
}