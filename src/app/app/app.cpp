#include "app.hpp"

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
	App::App() {
		this->window = new NugieVulkan::Window(WIDTH, HEIGHT, APP_TITLE);
		this->device = new NugieVulkan::Device(this->window);
		this->renderer = new Renderer(this->window, this->device);

		this->camera = new Camera(WIDTH, HEIGHT);
		
		this->loadObjects();
		this->init();		
		this->recordCommand();
	}

	App::~App() {
		if (this->rayIntersectRenderer != nullptr) delete this->rayIntersectRenderer;
		if (this->indirectRayGenRenderer != nullptr) delete this->indirectRayGenRenderer;		
		if (this->indirectRayHitRenderer != nullptr) delete this->indirectRayHitRenderer;
		if (this->lightRayHitRenderer != nullptr) delete this->lightRayHitRenderer;
		if (this->missRayRenderer != nullptr) delete this->missRayRenderer;
		if (this->directRayGenRenderer != nullptr) delete this->directRayGenRenderer;
		if (this->directRayHitRenderer != nullptr) delete this->directRayHitRenderer;
		if (this->integratorRenderer != nullptr) delete this->integratorRenderer;
		if (this->samplingRenderer != nullptr) delete this->samplingRenderer;

		if (this->renderer != nullptr) delete this->renderer;

		if (this->rayIntersectDescSet != nullptr) delete this->rayIntersectDescSet;
		if (this->indirectRayGenDescSet != nullptr) delete this->indirectRayGenDescSet;	
		if (this->indirectRayHitDescSet != nullptr) delete this->indirectRayHitDescSet;
		if (this->lightRayHitDescSet != nullptr) delete this->lightRayHitDescSet;
		if (this->missRayDescSet != nullptr) delete this->missRayDescSet;	
		if (this->directRayGenDescSet != nullptr) delete this->directRayGenDescSet;
		if (this->directRayHitDescSet != nullptr) delete this->directRayHitDescSet;		
		if (this->integratorDescSet != nullptr) delete this->integratorDescSet;
		if (this->samplingDescSet != nullptr) delete this->samplingDescSet;

		if (this->objectBvhBuffer != nullptr) delete this->objectBvhBuffer;
		if (this->objectBuffer != nullptr) delete this->objectBuffer;
		if (this->geometryBvhBuffer != nullptr) delete this->geometryBvhBuffer;
		if (this->triangleBuffer != nullptr) delete this->triangleBuffer;
		if (this->triangleLightBuffer != nullptr) delete this->triangleLightBuffer;
		if (this->vertexBuffer != nullptr) delete this->vertexBuffer;
		if (this->transformBuffer != nullptr) delete this->transformBuffer;
		if (this->materialBuffer != nullptr) delete this->materialBuffer;		

		if (this->rayTraceStorageBuffer != nullptr) delete this->rayTraceStorageBuffer;		
		if (this->rayTraceUniformBuffer != nullptr) delete this->rayTraceUniformBuffer;

		for (auto &&resultImage : this->resultImages) {
			if (resultImage != nullptr) delete resultImage;
		}		

		if (this->device != nullptr) delete this->device;
		if (this->window != nullptr) delete this->window;
	}

	void App::recordCommand() {
		auto prepareCommandBuffer = this->renderer->beginRecordPrepareCommand();

		for (auto &&swapChainImage : this->renderer->getSwapChain()->getswapChainImages()) {
			swapChainImage->transitionImageLayout(prepareCommandBuffer, VK_IMAGE_LAYOUT_UNDEFINED, VK_IMAGE_LAYOUT_PRESENT_SRC_KHR,
				VK_PIPELINE_STAGE_TOP_OF_PIPE_BIT, VK_PIPELINE_STAGE_TOP_OF_PIPE_BIT, 0, 0);
		}

		for (auto &&resultImage : this->resultImages) {
			resultImage->transitionImageLayout(prepareCommandBuffer, VK_IMAGE_LAYOUT_UNDEFINED, VK_IMAGE_LAYOUT_GENERAL,
				VK_PIPELINE_STAGE_TOP_OF_PIPE_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, 0, 0);
		}
		
		this->rayTraceStorageBuffer->initializeValue(prepareCommandBuffer);
		prepareCommandBuffer->endCommand();

		uint32_t imageCount = this->renderer->getSwapChain()->getImageCount();
		uint32_t height = this->renderer->getSwapChain()->getHeight();
		uint32_t width = this->renderer->getSwapChain()->getWidth();

		uint32_t h_tile_count = height / 8u;
		uint32_t w_tile_count = width / 8u;

		for (uint32_t imageIndex = 0; imageIndex < imageCount; imageIndex++) {
			for (uint32_t frameIndex = 0; frameIndex < NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT; frameIndex++) {
				auto commandBuffer = this->renderer->beginRecordRenderCommand(frameIndex, imageIndex);
				auto swapChainImage = this->renderer->getSwapChain()->getswapChainImages()[imageIndex];

				for (uint32_t i = 0; i < w_tile_count; i++) {
					for (uint32_t j = 0; j < h_tile_count; j++) {
						auto initialPixelCoord = glm::uvec2{ i * 8u, j * 8u };

						// -------------------------------------------------------------------------------------------------------------------

						this->rayTraceStorageBuffer->transitionBuffer(commandBuffer, frameIndex, "traced_ray", VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_SHADER_READ_BIT, VK_ACCESS_SHADER_WRITE_BIT);
						this->indirectRayGenRenderer->render(commandBuffer, 1, 1, 1, { this->indirectRayGenDescSet->getDescriptorSets(frameIndex) }, { &initialPixelCoord });
						this->rayTraceStorageBuffer->transitionBuffer(commandBuffer, frameIndex, "traced_ray", VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_SHADER_WRITE_BIT, VK_ACCESS_SHADER_READ_BIT);

						// -------------------------------------------------------------------------------------------------------------------

						this->rayTraceStorageBuffer->transitionBuffer(commandBuffer, frameIndex, "hit_record", VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_SHADER_READ_BIT, VK_ACCESS_SHADER_WRITE_BIT);
						this->rayIntersectRenderer->render(commandBuffer, 1, 1, 1, { this->rayIntersectDescSet->getDescriptorSets(frameIndex) });
						this->rayTraceStorageBuffer->transitionBuffer(commandBuffer, frameIndex, "hit_record", VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_SHADER_WRITE_BIT, VK_ACCESS_SHADER_READ_BIT);

						// -------------------------------------------------------------------------------------------------------------------

						this->rayTraceStorageBuffer->transitionBuffer(commandBuffer, frameIndex, "indirect_result", VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_SHADER_READ_BIT, VK_ACCESS_SHADER_WRITE_BIT);
						this->rayTraceStorageBuffer->transitionBuffer(commandBuffer, frameIndex, "direct_data", VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_SHADER_READ_BIT, VK_ACCESS_SHADER_WRITE_BIT);
						this->rayTraceStorageBuffer->transitionBuffer(commandBuffer, frameIndex, "scattered_ray", VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_SHADER_READ_BIT, VK_ACCESS_SHADER_WRITE_BIT);

						this->indirectRayHitRenderer->render(commandBuffer, 1, 1, 1, { this->indirectRayHitDescSet->getDescriptorSets(frameIndex) }, { &initialPixelCoord });

						this->rayTraceStorageBuffer->transitionBuffer(commandBuffer, frameIndex, "indirect_result", VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_SHADER_WRITE_BIT, VK_ACCESS_SHADER_READ_BIT);
						this->rayTraceStorageBuffer->transitionBuffer(commandBuffer, frameIndex, "direct_data", VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_SHADER_WRITE_BIT, VK_ACCESS_SHADER_READ_BIT);
						this->rayTraceStorageBuffer->transitionBuffer(commandBuffer, frameIndex, "scattered_ray", VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_SHADER_WRITE_BIT, VK_ACCESS_SHADER_READ_BIT);

						// -------------------------------------------------------------------------------------------------------------------

						this->rayTraceStorageBuffer->transitionBuffer(commandBuffer, frameIndex, "light_result", VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_SHADER_READ_BIT, VK_ACCESS_SHADER_WRITE_BIT);
						this->lightRayHitRenderer->render(commandBuffer, 1, 1, 1, { this->lightRayHitDescSet->getDescriptorSets(frameIndex) });
						this->rayTraceStorageBuffer->transitionBuffer(commandBuffer, frameIndex, "light_result", VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_SHADER_WRITE_BIT, VK_ACCESS_SHADER_READ_BIT);

						// -------------------------------------------------------------------------------------------------------------------

						this->rayTraceStorageBuffer->transitionBuffer(commandBuffer, frameIndex, "miss_result", VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_SHADER_READ_BIT, VK_ACCESS_SHADER_WRITE_BIT);
						this->missRayRenderer->render(commandBuffer, 1, 1, 1, { this->missRayDescSet->getDescriptorSets(frameIndex) });
						this->rayTraceStorageBuffer->transitionBuffer(commandBuffer, frameIndex, "miss_result", VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_SHADER_WRITE_BIT, VK_ACCESS_SHADER_READ_BIT);

						// -------------------------------------------------------------------------------------------------------------------

						this->rayTraceStorageBuffer->transitionBuffer(commandBuffer, frameIndex, "traced_ray", VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_SHADER_READ_BIT, VK_ACCESS_SHADER_WRITE_BIT);
						this->directRayGenRenderer->render(commandBuffer, 1, 1, 1, { this->directRayGenDescSet->getDescriptorSets(frameIndex) });
						this->rayTraceStorageBuffer->transitionBuffer(commandBuffer, frameIndex, "traced_ray", VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_SHADER_WRITE_BIT, VK_ACCESS_SHADER_READ_BIT);

						// -------------------------------------------------------------------------------------------------------------------

						this->rayTraceStorageBuffer->transitionBuffer(commandBuffer, frameIndex, "hit_record", VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_SHADER_READ_BIT, VK_ACCESS_SHADER_WRITE_BIT);
						this->rayIntersectRenderer->render(commandBuffer, 1, 1, 1, { this->rayIntersectDescSet->getDescriptorSets(frameIndex) });
						this->rayTraceStorageBuffer->transitionBuffer(commandBuffer, frameIndex, "hit_record", VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_SHADER_WRITE_BIT, VK_ACCESS_SHADER_READ_BIT);

						// -------------------------------------------------------------------------------------------------------------------

						this->rayTraceStorageBuffer->transitionBuffer(commandBuffer, frameIndex, "direct_result", VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_SHADER_READ_BIT, VK_ACCESS_SHADER_WRITE_BIT);
						this->directRayHitRenderer->render(commandBuffer, 1, 1, 1, { this->directRayHitDescSet->getDescriptorSets(frameIndex) });
						this->rayTraceStorageBuffer->transitionBuffer(commandBuffer, frameIndex, "direct_result", VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_SHADER_WRITE_BIT, VK_ACCESS_SHADER_READ_BIT);

						// -------------------------------------------------------------------------------------------------------------------

						this->rayTraceStorageBuffer->transitionBuffer(commandBuffer, frameIndex, "integrator_result", VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_SHADER_READ_BIT, VK_ACCESS_SHADER_READ_BIT | VK_ACCESS_SHADER_WRITE_BIT);
						this->integratorRenderer->render(commandBuffer, 1, 1, 1, { this->integratorDescSet->getDescriptorSets(frameIndex) }, { &initialPixelCoord });
						this->rayTraceStorageBuffer->transitionBuffer(commandBuffer, frameIndex, "integrator_result", VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_SHADER_READ_BIT | VK_ACCESS_SHADER_WRITE_BIT, VK_ACCESS_SHADER_READ_BIT);

						// -------------------------------------------------------------------------------------------------------------------

						this->rayTraceStorageBuffer->transitionBuffer(commandBuffer, frameIndex, "sampling_result", VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_SHADER_READ_BIT | VK_ACCESS_SHADER_WRITE_BIT, VK_ACCESS_SHADER_READ_BIT | VK_ACCESS_SHADER_WRITE_BIT);
						this->samplingRenderer->render(commandBuffer, 1,1, 1, { this->samplingDescSet->getDescriptorSets(frameIndex) }, { &initialPixelCoord });
						this->rayTraceStorageBuffer->transitionBuffer(commandBuffer, frameIndex, "sampling_result", VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_SHADER_READ_BIT | VK_ACCESS_SHADER_WRITE_BIT, VK_ACCESS_SHADER_READ_BIT | VK_ACCESS_SHADER_WRITE_BIT);

						// -------------------------------------------------------------------------------------------------------------------

						this->resultImages[frameIndex]->transitionImageLayout(commandBuffer, VK_IMAGE_LAYOUT_GENERAL, VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_TRANSFER_BIT, VK_ACCESS_SHADER_WRITE_BIT, VK_ACCESS_TRANSFER_READ_BIT);
						swapChainImage->transitionImageLayout(commandBuffer, VK_IMAGE_LAYOUT_PRESENT_SRC_KHR, VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL, VK_PIPELINE_STAGE_TOP_OF_PIPE_BIT, VK_PIPELINE_STAGE_TRANSFER_BIT, 0, VK_ACCESS_TRANSFER_WRITE_BIT);

						this->resultImages[frameIndex]->copyImageToOther(commandBuffer, swapChainImage);

						this->resultImages[frameIndex]->transitionImageLayout(commandBuffer, VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL, VK_IMAGE_LAYOUT_GENERAL, VK_PIPELINE_STAGE_TRANSFER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_TRANSFER_READ_BIT, VK_ACCESS_SHADER_WRITE_BIT);
						swapChainImage->transitionImageLayout(commandBuffer, VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL, VK_IMAGE_LAYOUT_PRESENT_SRC_KHR, VK_PIPELINE_STAGE_TRANSFER_BIT, VK_PIPELINE_STAGE_BOTTOM_OF_PIPE_BIT, VK_ACCESS_TRANSFER_WRITE_BIT, 0);

						// -------------------------------------------------------------------------------------------------------------------
					}
				}
				
				commandBuffer->endCommand();
			}
		}
	}

	void App::renderLoop() {
		this->renderer->submitPrepareCommand();

		while (this->isRendering) {
			this->frameCount++;

			if (this->renderer->acquireFrame()) {
				uint32_t frameIndex = this->renderer->getFrameIndex();

				this->rayTraceUbo.imgSizeRandomSeedNumLight.z = this->randomSeed;
				this->rayTraceUniformBuffer->writeGlobalData(frameIndex, this->rayTraceUbo);
				
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

	void App::loadObjects() {
		std::vector<Object> objects;
		std::vector<BvhNode> bvhObjects;
		std::vector<Triangle> triangles;
		std::vector<Triangle> triangleLights;
		std::vector<BvhNode> bvhTriangles;
		std::vector<Vertex> vertices;
		std::vector<Transformation> transforms;
		std::vector<Material> materials;		

		std::vector<BoundBox*> objectBoundBoxes;
		std::vector<BoundBox*> triangleBoundBoxes;
		std::vector<Triangle> curTris;
		std::vector<TransformComponent> transformComponents;

		// ----------------------------------------------------------------------------		
		// kanan

		vertices.emplace_back(Vertex{ glm::vec3{ 555.0f, 0.0f, 0.0f }, glm::vec3{ -1.0f, 0.0f, 0.0f } });
		vertices.emplace_back(Vertex{ glm::vec3{ 555.0f, 555.0f, 0.0f }, glm::vec3{ -1.0f, 0.0f, 0.0f } });
		vertices.emplace_back(Vertex{ glm::vec3{ 555.0f, 555.0f, 555.0f }, glm::vec3{ -1.0f, 0.0f, 0.0f } });
		vertices.emplace_back(Vertex{ glm::vec3{ 555.0f, 0.0f, 555.0f }, glm::vec3{ -1.0f, 0.0f, 0.0f } });

		curTris.clear();
		curTris.emplace_back(Triangle{ glm::uvec4{ 0u, 1u, 2u, 1u } });
		curTris.emplace_back(Triangle{ glm::uvec4{ 2u, 3u, 0u, 1u } });		

		transformComponents.emplace_back(TransformComponent{ glm::vec3(1.0f, 0.0f, 0.0f), glm::vec3(1.0f), glm::vec3(0.0f) });
		uint32_t transformIndex = static_cast<uint32_t>(transformComponents.size() - 1);

		objects.emplace_back(Object{ static_cast<uint32_t>(bvhTriangles.size()), static_cast<uint32_t>(triangles.size()), transformIndex });
		uint32_t objSize = static_cast<uint32_t>(objects.size());

		objectBoundBoxes.emplace_back(new ObjectBoundBox{ objSize, objects[objSize - 1u], transformComponents[transformIndex], curTris, vertices });
		uint32_t boundBoxIndex = static_cast<uint32_t>(objectBoundBoxes.size() - 1);

		triangleBoundBoxes.clear();
		for (uint32_t i = 0; i < static_cast<uint32_t>(curTris.size()); i++) {
			triangleBoundBoxes.emplace_back(new TriangleBoundBox{ i + 1, curTris[i], vertices });
		}		

		for (auto &&curTri : curTris) {
			triangles.emplace_back(curTri);
		}

		for (auto &&bvhTri : createBvh(triangleBoundBoxes)) {
			bvhTriangles.emplace_back(bvhTri);
		}

		transformComponents[transformIndex].objectMaximum = objectBoundBoxes[boundBoxIndex]->getOriginalMax();
		transformComponents[transformIndex].objectMinimum = objectBoundBoxes[boundBoxIndex]->getOriginalMin();

		// ----------------------------------------------------------------------------
		// kiri
		
		vertices.emplace_back(Vertex{ glm::vec3{ 0.0f, 0.0f, 0.0f }, glm::vec3{ 1.0f, 0.0f, 0.0f } });
		vertices.emplace_back(Vertex{ glm::vec3{ 0.0f, 555.0f, 0.0f }, glm::vec3{ 1.0f, 0.0f, 0.0f } });
		vertices.emplace_back(Vertex{ glm::vec3{ 0.0f, 555.0f, 555.0f }, glm::vec3{ 1.0f, 0.0f, 0.0f } });
		vertices.emplace_back(Vertex{ glm::vec3{ 0.0f, 0.0f, 555.0f }, glm::vec3{ 1.0f, 0.0f, 0.0f } });

		curTris.clear();
		curTris.emplace_back(Triangle{ glm::uvec4{ 4u, 5u, 6u, 2u } });
		curTris.emplace_back(Triangle{ glm::uvec4{ 6u, 7u, 4u, 2u } });

		transformComponents.emplace_back(TransformComponent{ glm::vec3(0.0f), glm::vec3(1.0f), glm::vec3(0.0f) });
		transformIndex = static_cast<uint32_t>(transformComponents.size() - 1);

		objects.emplace_back(Object{ static_cast<uint32_t>(bvhTriangles.size()), static_cast<uint32_t>(triangles.size()), transformIndex });
		objSize = static_cast<uint32_t>(objects.size());

		objectBoundBoxes.emplace_back(new ObjectBoundBox{ objSize, objects[objSize - 1u], transformComponents[transformIndex], curTris, vertices });
		boundBoxIndex = static_cast<uint32_t>(objectBoundBoxes.size() - 1);

		triangleBoundBoxes.clear();
		for (uint32_t i = 0; i < static_cast<uint32_t>(curTris.size()); i++) {
			triangleBoundBoxes.emplace_back(new TriangleBoundBox{ i + 1, curTris[i], vertices });
		}		

		for (auto &&curTri : curTris) {
			triangles.emplace_back(curTri);
		}

		for (auto &&bvhTri : createBvh(triangleBoundBoxes)) {
			bvhTriangles.emplace_back(bvhTri);
		}

		transformComponents[transformIndex].objectMaximum = objectBoundBoxes[boundBoxIndex]->getOriginalMax();
		transformComponents[transformIndex].objectMinimum = objectBoundBoxes[boundBoxIndex]->getOriginalMin();

		// ----------------------------------------------------------------------------
		// bawah

		vertices.emplace_back(Vertex{ glm::vec3{ 0.0f, 0.0f, 0.0f }, glm::vec3{ 0.0f, 1.0f, 0.0f } });
		vertices.emplace_back(Vertex{ glm::vec3{ 555.0f, 0.0f, 0.0f }, glm::vec3{ 0.0f, 1.0f, 0.0f } });
		vertices.emplace_back(Vertex{ glm::vec3{ 555.0f, 0.0f, 555.0f }, glm::vec3{ 0.0f, 1.0f, 0.0f } });
		vertices.emplace_back(Vertex{ glm::vec3{ 0.0f, 0.0f, 555.0f }, glm::vec3{ 0.0f, 1.0f, 0.0f } });
		
		curTris.clear();
		curTris.emplace_back(Triangle{ glm::uvec4{ 8u, 9u, 10u, 0u } });
		curTris.emplace_back(Triangle{ glm::uvec4{ 10u, 11u, 8u, 0u } });

		transformComponents.emplace_back(TransformComponent{ glm::vec3(0.0f), glm::vec3(1.0f), glm::vec3(0.0f) });
		transformIndex = static_cast<uint32_t>(transformComponents.size() - 1);

		objects.emplace_back(Object{ static_cast<uint32_t>(bvhTriangles.size()), static_cast<uint32_t>(triangles.size()), transformIndex });
		objSize = static_cast<uint32_t>(objects.size());

		objectBoundBoxes.emplace_back(new ObjectBoundBox{ objSize, objects[objSize - 1u], transformComponents[transformIndex], curTris, vertices });
		boundBoxIndex = static_cast<uint32_t>(objectBoundBoxes.size() - 1);

		triangleBoundBoxes.clear();
		for (uint32_t i = 0; i < static_cast<uint32_t>(curTris.size()); i++) {
			triangleBoundBoxes.emplace_back(new TriangleBoundBox{ i + 1, curTris[i], vertices });
		}		

		for (auto &&curTri : curTris) {
			triangles.emplace_back(curTri);
		}

		for (auto &&bvhTri : createBvh(triangleBoundBoxes)) {
			bvhTriangles.emplace_back(bvhTri);
		}

		transformComponents[transformIndex].objectMaximum = objectBoundBoxes[boundBoxIndex]->getOriginalMax();
		transformComponents[transformIndex].objectMinimum = objectBoundBoxes[boundBoxIndex]->getOriginalMin();

		// ----------------------------------------------------------------------------
		// atas

		vertices.emplace_back(Vertex{ glm::vec3{ 0.0f, 555.0f, 0.0f }, glm::vec3{ 0.0f, -1.0f, 0.0f } });
		vertices.emplace_back(Vertex{ glm::vec3{ 555.0f, 555.0f, 0.0f }, glm::vec3{ 0.0f, -1.0f, 0.0f } });
		vertices.emplace_back(Vertex{ glm::vec3{ 555.0f, 555.0f, 555.0f }, glm::vec3{ 0.0f, -1.0f, 0.0f } });
		vertices.emplace_back(Vertex{ glm::vec3{ 0.0f, 555.0f, 555.0f }, glm::vec3{ 0.0f, -1.0f, 0.0f } });
		
		curTris.clear();
		curTris.emplace_back(Triangle{ glm::uvec4{ 12u, 13u, 14u, 0u } });
		curTris.emplace_back(Triangle{ glm::uvec4{ 14u, 15u, 12u, 0u } });

		transformComponents.emplace_back(TransformComponent{ glm::vec3(0.0f), glm::vec3(1.0f), glm::vec3(0.0f) });
		transformIndex = static_cast<uint32_t>(transformComponents.size() - 1);

		objects.emplace_back(Object{ static_cast<uint32_t>(bvhTriangles.size()), static_cast<uint32_t>(triangles.size()), transformIndex });
		objSize = static_cast<uint32_t>(objects.size());

		objectBoundBoxes.emplace_back(new ObjectBoundBox{ objSize, objects[objSize - 1u], transformComponents[transformIndex], curTris, vertices });
		boundBoxIndex = static_cast<uint32_t>(objectBoundBoxes.size() - 1);

		triangleBoundBoxes.clear();
		for (uint32_t i = 0; i < static_cast<uint32_t>(curTris.size()); i++) {
			triangleBoundBoxes.emplace_back(new TriangleBoundBox{ i + 1, curTris[i], vertices });
		}		

		for (auto &&curTri : curTris) {
			triangles.emplace_back(curTri);
		}

		for (auto &&bvhTri : createBvh(triangleBoundBoxes)) {
			bvhTriangles.emplace_back(bvhTri);
		}

		transformComponents[transformIndex].objectMaximum = objectBoundBoxes[boundBoxIndex]->getOriginalMax();
		transformComponents[transformIndex].objectMinimum = objectBoundBoxes[boundBoxIndex]->getOriginalMin();

		// ----------------------------------------------------------------------------
		// depan

		vertices.emplace_back(Vertex{ glm::vec3{ 0.0f, 0.0f, 555.0f }, glm::vec3{ 0.0f, 0.0f, -1.0f } });
		vertices.emplace_back(Vertex{ glm::vec3{ 0.0f, 555.0f, 555.0f }, glm::vec3{ 0.0f, 0.0f, -1.0f } });
		vertices.emplace_back(Vertex{ glm::vec3{ 555.0f, 555.0f, 555.0f }, glm::vec3{ 0.0f, 0.0f, -1.0f } });
		vertices.emplace_back(Vertex{ glm::vec3{ 555.0f, 0.0f, 555.0f }, glm::vec3{ 0.0f, 0.0f, -1.0f } });
		
		curTris.clear();
		curTris.emplace_back(Triangle{ glm::uvec4{ 16u, 17u, 18u, 0u } });
		curTris.emplace_back(Triangle{ glm::uvec4{ 18u, 19u, 16u, 0u } });

		transformComponents.emplace_back(TransformComponent{ glm::vec3(0.0f), glm::vec3(1.0f), glm::vec3(0.0f) });
		transformIndex = static_cast<uint32_t>(transformComponents.size() - 1);

		objects.emplace_back(Object{ static_cast<uint32_t>(bvhTriangles.size()), static_cast<uint32_t>(triangles.size()), transformIndex });
		objSize = static_cast<uint32_t>(objects.size());

		objectBoundBoxes.emplace_back(new ObjectBoundBox{ objSize, objects[objSize - 1u], transformComponents[transformIndex], curTris, vertices });
		boundBoxIndex = static_cast<uint32_t>(objectBoundBoxes.size() - 1);

		triangleBoundBoxes.clear();
		for (uint32_t i = 0; i < static_cast<uint32_t>(curTris.size()); i++) {
			triangleBoundBoxes.emplace_back(new TriangleBoundBox{ i + 1, curTris[i], vertices });
		}		

		for (auto &&curTri : curTris) {
			triangles.emplace_back(curTri);
		}

		for (auto &&bvhTri : createBvh(triangleBoundBoxes)) {
			bvhTriangles.emplace_back(bvhTri);
		}

		transformComponents[transformIndex].objectMaximum = objectBoundBoxes[boundBoxIndex]->getOriginalMax();
		transformComponents[transformIndex].objectMinimum = objectBoundBoxes[boundBoxIndex]->getOriginalMin();

		// ----------------------------------------------------------------------------
		// light

		vertices.emplace_back(Vertex{ glm::vec3{ 213.0f, 554.0f, 227.0f }, glm::vec3{ 0.0f, -1.0f, 0.0f } });
		vertices.emplace_back(Vertex{ glm::vec3{ 343.0f, 554.0f, 227.0f }, glm::vec3{ 0.0f, -1.0f, 0.0f } });
		vertices.emplace_back(Vertex{ glm::vec3{ 343.0f, 554.0f, 332.0f }, glm::vec3{ 0.0f, -1.0f, 0.0f } });
		vertices.emplace_back(Vertex{ glm::vec3{ 213.0f, 554.0f, 332.0f }, glm::vec3{ 0.0f, -1.0f, 0.0f } });
			
		curTris.clear();
		curTris.emplace_back(Triangle{ glm::uvec4{ 20u, 21u, 22u, 0u } });
		curTris.emplace_back(Triangle{ glm::uvec4{ 22u, 23u, 20u, 0u } });

		transformComponents.emplace_back(TransformComponent{ glm::vec3(0.0f), glm::vec3(1.0f), glm::vec3(0.0f) });
		transformIndex = static_cast<uint32_t>(transformComponents.size() - 1);

		objects.emplace_back(Object{ static_cast<uint32_t>(bvhTriangles.size()), static_cast<uint32_t>(triangleLights.size()), transformIndex });
		objSize = static_cast<uint32_t>(objects.size());

		objectBoundBoxes.emplace_back(new ObjectBoundBox{ objSize, objects[objSize - 1u], transformComponents[transformIndex], curTris, vertices });
		boundBoxIndex = static_cast<uint32_t>(objectBoundBoxes.size() - 1);

		triangleBoundBoxes.clear();
		for (uint32_t i = 0; i < static_cast<uint32_t>(curTris.size()); i++) {
			triangleBoundBoxes.emplace_back(new TriangleLightBoundBox{ i + 1, curTris[i], vertices });
		}		

		for (auto &&curTri : curTris) {
			triangleLights.emplace_back(curTri);
		}

		for (auto &&bvhTri : createBvh(triangleBoundBoxes)) {
			bvhTriangles.emplace_back(bvhTri);
		}

		transformComponents[transformIndex].objectMaximum = objectBoundBoxes[boundBoxIndex]->getOriginalMax();
		transformComponents[transformIndex].objectMinimum = objectBoundBoxes[boundBoxIndex]->getOriginalMin();

		// ----------------------------------------------------------------------------

		materials.emplace_back(Material{ glm::vec4(0.73f, 0.73f, 0.73f, 1.0f) });
		materials.emplace_back(Material{ glm::vec4(0.12f, 0.45f, 0.15f, 1.0f) });
		materials.emplace_back(Material{ glm::vec4(0.65f, 0.05f, 0.05f, 1.0f) });		

		transforms = ConvertComponentToTransform(transformComponents);
		bvhObjects = createBvh(objectBoundBoxes);

		this->rayTraceUbo.imgSizeRandomSeedNumLight.w = static_cast<uint32_t>(triangleLights.size());

		// ----------------------------------------------------------------------------

		this->objectBuffer = new ArrayBuffer<Object>(this->device, VK_BUFFER_USAGE_STORAGE_BUFFER_BIT, static_cast<uint32_t>(objects.size()));
		this->objectBvhBuffer = new ArrayBuffer<BvhNode>(this->device, VK_BUFFER_USAGE_STORAGE_BUFFER_BIT, static_cast<uint32_t>(bvhObjects.size()));
		this->triangleBuffer = new ArrayBuffer<Triangle>(this->device, VK_BUFFER_USAGE_STORAGE_BUFFER_BIT, static_cast<uint32_t>(triangles.size()));
		this->triangleLightBuffer = new ArrayBuffer<Triangle>(this->device, VK_BUFFER_USAGE_STORAGE_BUFFER_BIT, static_cast<uint32_t>(triangleLights.size()));
		this->geometryBvhBuffer = new ArrayBuffer<BvhNode>(this->device, VK_BUFFER_USAGE_STORAGE_BUFFER_BIT, static_cast<uint32_t>(bvhTriangles.size()));
		this->vertexBuffer = new ArrayBuffer<Vertex>(this->device, VK_BUFFER_USAGE_STORAGE_BUFFER_BIT, static_cast<uint32_t>(vertices.size()));
		this->transformBuffer = new ArrayBuffer<Transformation>(this->device, VK_BUFFER_USAGE_STORAGE_BUFFER_BIT, static_cast<uint32_t>(transforms.size()));
		this->materialBuffer = new ArrayBuffer<Material>(this->device, VK_BUFFER_USAGE_STORAGE_BUFFER_BIT, static_cast<uint32_t>(materials.size()));		

		auto commandBuffer = this->renderer->beginRecordTransferCommand();

		this->objectBuffer->replace(commandBuffer, objects);
		this->objectBvhBuffer->replace(commandBuffer, bvhObjects);
		this->triangleBuffer->replace(commandBuffer, triangles);
		this->triangleLightBuffer->replace(commandBuffer, triangleLights);
		this->geometryBvhBuffer->replace(commandBuffer, bvhTriangles);		
		this->vertexBuffer->replace(commandBuffer, vertices);
		this->transformBuffer->replace(commandBuffer, transforms);
		this->materialBuffer->replace(commandBuffer, materials);

		commandBuffer->endCommand();
		this->renderer->submitTransferCommand();
	}

	void App::initCamera(uint32_t width, uint32_t height) {
		RayTraceUbo ubo{};

		this->camera->setViewDirection(glm::vec3{278.0f, 278.0f, -800.0f}, glm::vec3{0.0f, 0.0f, 1.0f}, 40.0f);
		CameraRay cameraRay = this->camera->getCameraRay();
		
		this->rayTraceUbo.origin = cameraRay.origin;
		this->rayTraceUbo.horizontal = cameraRay.horizontal;
		this->rayTraceUbo.vertical = cameraRay.vertical;
		this->rayTraceUbo.lowerLeftCorner = cameraRay.lowerLeftCorner;
		this->rayTraceUbo.imgSizeRandomSeedNumLight = glm::uvec4{width, height, 0u, 0u};
	}

	void App::init() {
		uint32_t width = this->renderer->getSwapChain()->getWidth();
		uint32_t height = this->renderer->getSwapChain()->getHeight();
		uint32_t imageCount = static_cast<uint32_t>(this->renderer->getSwapChain()->getImageCount());
		VkSampleCountFlagBits msaaSample = this->device->getMSAASamples();

		uint32_t totalCount = 8 * 8;
		this->initCamera(width, height);

		this->rayTraceUniformBuffer = new ObjectBuffer<RayTraceUbo>(this->device, VK_BUFFER_USAGE_UNIFORM_BUFFER_BIT | VK_BUFFER_USAGE_TRANSFER_DST_BIT);

		this->rayTraceStorageBuffer = StackedArrayManyBuffer::Builder(this->device, VK_BUFFER_USAGE_STORAGE_BUFFER_BIT | VK_BUFFER_USAGE_TRANSFER_DST_BIT, NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT)
			.addArrayItem("traced_ray", static_cast<VkDeviceSize>(sizeof(Ray)), totalCount) // Traced Ray
			.addArrayItem("hit_record", static_cast<VkDeviceSize>(sizeof(Hit)), totalCount)
			.addArrayItem("indirect_result", static_cast<VkDeviceSize>(sizeof(IndirectResult)), totalCount)
			.addArrayItem("light_result", static_cast<VkDeviceSize>(sizeof(LightResult)), totalCount)
			.addArrayItem("miss_result", static_cast<VkDeviceSize>(sizeof(MissResult)), totalCount)
			.addArrayItem("direct_data", static_cast<VkDeviceSize>(sizeof(DirectData)), totalCount)
			.addArrayItem("direct_result", static_cast<VkDeviceSize>(sizeof(DirectResult)), totalCount)
			.addArrayItem("integrator_result", static_cast<VkDeviceSize>(sizeof(IntegratorResult)), width * height)
			.addArrayItem("sampling_result", static_cast<VkDeviceSize>(sizeof(SamplingResult)), width * height)
			.addArrayItem("scattered_ray", static_cast<VkDeviceSize>(sizeof(Ray)), width * height) // Scatteres Ray
			.build();

		std::vector<VkDescriptorImageInfo> resultImageInfos { NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT };
		this->resultImages.resize(NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT);

		for (uint32_t i = 0; i < NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT; i++) {
			this->resultImages[i] = new NugieVulkan::Image(this->device, width, height, 1, VK_SAMPLE_COUNT_1_BIT, VK_FORMAT_R32G32B32A32_SFLOAT,
        VK_IMAGE_TILING_OPTIMAL, VK_IMAGE_USAGE_STORAGE_BIT | VK_IMAGE_USAGE_TRANSFER_SRC_BIT, VMA_MEMORY_USAGE_AUTO,
				VMA_ALLOCATION_CREATE_DEDICATED_MEMORY_BIT, VK_IMAGE_ASPECT_COLOR_BIT);

			resultImageInfos[i] = this->resultImages[i]->getDescriptorInfo(VK_IMAGE_LAYOUT_GENERAL);
		}

		this->indirectRayGenDescSet = DescriptorSet::Builder(this->device, this->renderer->getDescriptorPool(), NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT)
			.addBuffer(0, VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->rayTraceUniformBuffer->getInfo())
			.addBuffer(1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->rayTraceStorageBuffer->getInfo("traced_ray"))
			.addBuffer(2, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->rayTraceStorageBuffer->getInfo("scattered_ray"))
			.addBuffer(3, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->rayTraceStorageBuffer->getInfo("integrator_result"))
			.build();

		this->rayIntersectDescSet = DescriptorSet::Builder(this->device, this->renderer->getDescriptorPool(), NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT)
			.addBuffer(0, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->rayTraceStorageBuffer->getInfo("hit_record"))
			.addBuffer(1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->rayTraceStorageBuffer->getInfo("traced_ray"))
			.addBuffer(2, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->objectBvhBuffer->getInfo())
			.addBuffer(3, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->objectBuffer->getInfo())
			.addBuffer(4, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->geometryBvhBuffer->getInfo())
			.addBuffer(5, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->triangleBuffer->getInfo())
			.addBuffer(6, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->triangleLightBuffer->getInfo())
			.addBuffer(7, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->vertexBuffer->getInfo())
			.addBuffer(8, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->transformBuffer->getInfo())
			.build();

		this->indirectRayHitDescSet = DescriptorSet::Builder(this->device, this->renderer->getDescriptorPool(), NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT)
			.addBuffer(0, VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->rayTraceUniformBuffer->getInfo())
			.addBuffer(1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->rayTraceStorageBuffer->getInfo("indirect_result"))
			.addBuffer(2, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->rayTraceStorageBuffer->getInfo("direct_data"))
			.addBuffer(3, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->rayTraceStorageBuffer->getInfo("scattered_ray"))
			.addBuffer(4, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->rayTraceStorageBuffer->getInfo("traced_ray"))
			.addBuffer(5, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->rayTraceStorageBuffer->getInfo("hit_record"))
			.addBuffer(6, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->triangleBuffer->getInfo())
			.addBuffer(7, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->vertexBuffer->getInfo())
			.addBuffer(8, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->materialBuffer->getInfo())			
			.build();

		this->lightRayHitDescSet = DescriptorSet::Builder(this->device, this->renderer->getDescriptorPool(), NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT)
			.addBuffer(0, VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->rayTraceUniformBuffer->getInfo())
			.addBuffer(1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->rayTraceStorageBuffer->getInfo("light_result"))
			.addBuffer(2, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->rayTraceStorageBuffer->getInfo("traced_ray"))
			.addBuffer(3, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->rayTraceStorageBuffer->getInfo("hit_record"))
			.addBuffer(4, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->triangleLightBuffer->getInfo())
			.addBuffer(5, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->vertexBuffer->getInfo())			
			.build();

		this->missRayDescSet = DescriptorSet::Builder(this->device, this->renderer->getDescriptorPool(), NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT)
			.addBuffer(0, VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->rayTraceUniformBuffer->getInfo())
			.addBuffer(1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->rayTraceStorageBuffer->getInfo("miss_result"))
			.addBuffer(2, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->rayTraceStorageBuffer->getInfo("hit_record"))		
			.build();

		this->directRayGenDescSet = DescriptorSet::Builder(this->device, this->renderer->getDescriptorPool(), NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT)
			.addBuffer(0, VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->rayTraceUniformBuffer->getInfo())
			.addBuffer(1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->rayTraceStorageBuffer->getInfo("traced_ray"))
			.addBuffer(2, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->rayTraceStorageBuffer->getInfo("direct_data"))
			.addBuffer(3, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->triangleLightBuffer->getInfo())
			.addBuffer(4, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->vertexBuffer->getInfo())		
			.build();

		this->directRayHitDescSet = DescriptorSet::Builder(this->device, this->renderer->getDescriptorPool(), NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT)
			.addBuffer(0, VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->rayTraceUniformBuffer->getInfo())
			.addBuffer(1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->rayTraceStorageBuffer->getInfo("direct_result"))
			.addBuffer(2, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->rayTraceStorageBuffer->getInfo("direct_data"))
			.addBuffer(3, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->rayTraceStorageBuffer->getInfo("traced_ray"))
			.addBuffer(4, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->rayTraceStorageBuffer->getInfo("hit_record"))
			.addBuffer(5, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->triangleLightBuffer->getInfo())
			.addBuffer(6, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->vertexBuffer->getInfo())
			.addBuffer(7, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->materialBuffer->getInfo())		
			.build();

		this->integratorDescSet = DescriptorSet::Builder(this->device, this->renderer->getDescriptorPool(), NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT)
			.addBuffer(0, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->rayTraceStorageBuffer->getInfo("integrator_result"))
			.addBuffer(1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->rayTraceStorageBuffer->getInfo("indirect_result"))
			.addBuffer(2, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->rayTraceStorageBuffer->getInfo("light_result"))
			.addBuffer(3, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->rayTraceStorageBuffer->getInfo("direct_result"))
			.addBuffer(4, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->rayTraceStorageBuffer->getInfo("miss_result"))
			.build();
		
		this->samplingDescSet = DescriptorSet::Builder(this->device, this->renderer->getDescriptorPool(), NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT)			
			.addImage(0, VK_DESCRIPTOR_TYPE_STORAGE_IMAGE, VK_SHADER_STAGE_COMPUTE_BIT, resultImageInfos)
			.addBuffer(1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->rayTraceStorageBuffer->getInfo("sampling_result"))
			.addBuffer(2, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->rayTraceStorageBuffer->getInfo("integrator_result"))
			.build();

		VkPushConstantRange pushConstantRange{};
		pushConstantRange.stageFlags = VK_SHADER_STAGE_COMPUTE_BIT;
		pushConstantRange.offset = 0u;
		pushConstantRange.size = sizeof(glm::uvec2);
		
		this->indirectRayGenRenderer = new ComputeRenderSystem(this->device, "shader/indirect_ray_gen.comp.spv", { this->indirectRayGenDescSet->getDescSetLayout() }, { pushConstantRange });
		this->rayIntersectRenderer = new ComputeRenderSystem(this->device, "shader/ray_intersect.comp.spv", { this->rayIntersectDescSet->getDescSetLayout() });
		this->indirectRayHitRenderer = new ComputeRenderSystem(this->device, "shader/indirect_ray_hit.comp.spv", { this->indirectRayHitDescSet->getDescSetLayout() }, { pushConstantRange });
		this->lightRayHitRenderer = new ComputeRenderSystem(this->device, "shader/light_ray_hit.comp.spv", { this->lightRayHitDescSet->getDescSetLayout() });
		this->missRayRenderer = new ComputeRenderSystem(this->device, "shader/ray_miss.comp.spv", { this->missRayDescSet->getDescSetLayout() });
		this->directRayGenRenderer = new ComputeRenderSystem(this->device, "shader/direct_ray_gen.comp.spv", { this->directRayGenDescSet->getDescSetLayout() });
		this->directRayHitRenderer = new ComputeRenderSystem(this->device, "shader/direct_ray_hit.comp.spv", { this->directRayHitDescSet->getDescSetLayout() });
		this->integratorRenderer = new ComputeRenderSystem(this->device, "shader/integrator.comp.spv", { this->integratorDescSet->getDescSetLayout() }, { pushConstantRange });
		this->samplingRenderer = new ComputeRenderSystem(this->device, "shader/sampling.comp.spv", { this->samplingDescSet->getDescSetLayout() }, { pushConstantRange });

		this->indirectRayGenRenderer->initialize();
		this->rayIntersectRenderer->initialize();
		this->indirectRayHitRenderer->initialize();
		this->lightRayHitRenderer->initialize();
		this->missRayRenderer->initialize();
		this->directRayGenRenderer->initialize();
		this->directRayHitRenderer->initialize();
		this->integratorRenderer->initialize();
		this->samplingRenderer->initialize();
	}

	void App::resize() {
		uint32_t width = this->renderer->getSwapChain()->getWidth();
		uint32_t height = this->renderer->getSwapChain()->getHeight();
		uint32_t imageCount = static_cast<uint32_t>(this->renderer->getSwapChain()->getImageCount());
		VkSampleCountFlagBits msaaSample = this->device->getMSAASamples();

		this->renderer->resetCommandPool();
		this->recordCommand();
	}
}