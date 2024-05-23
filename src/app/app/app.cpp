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

		this->camera = new Camera();

		this->loadObjects();
		this->init();
		this->recordCommand();
	}

	App::~App() {
		if (this->forwardPassRenderer != nullptr) delete this->forwardPassRenderer;
		if (this->rayGenRenderer != nullptr) delete this->rayGenRenderer;
		if (this->rayIntersectRenderer != nullptr) delete this->rayIntersectRenderer;
		if (this->rayHitRenderer != nullptr) delete this->rayHitRenderer;
		if (this->samplingRenderer != nullptr) delete this->samplingRenderer;

		if (this->renderer != nullptr) delete this->renderer;
		if (this->forwardSubRenderer != nullptr) delete this->forwardSubRenderer;

		if (this->forwardDescSet != nullptr) delete this->forwardDescSet;
		if (this->rayGenDescSet != nullptr) delete this->rayGenDescSet;
		if (this->rayIntersectDescSet != nullptr) delete this->rayIntersectDescSet;
		if (this->rayHitDescSet != nullptr) delete this->rayHitDescSet;
		if (this->samplingDescSet != nullptr) delete this->samplingDescSet;

		if (this->objectBvhBuffer != nullptr) delete this->objectBvhBuffer;
		if (this->objectBuffer != nullptr) delete this->objectBuffer;
		if (this->geometryBvhBuffer != nullptr) delete this->geometryBvhBuffer;
		if (this->triangleBuffer != nullptr) delete this->triangleBuffer;
		if (this->triangleLightBuffer != nullptr) delete this->triangleLightBuffer;
		if (this->vertexBuffer != nullptr) delete this->vertexBuffer;
		if (this->referenceBuffer != nullptr) delete this->referenceBuffer;
		if (this->indexBuffer != nullptr) delete this->indexBuffer;
		if (this->transformBuffer != nullptr) delete this->transformBuffer;
		if (this->materialBuffer != nullptr) delete this->materialBuffer;		

		if (this->rayGenBuffer != nullptr) delete this->rayGenBuffer;		
		if (this->rayIntersectBuffer != nullptr) delete this->rayIntersectBuffer;
		if (this->rayHitBuffer != nullptr) delete this->rayHitBuffer;
		if (this->rayTraceUniformBuffer != nullptr) delete this->rayTraceUniformBuffer;
		if (this->cameraTransformationBuffer != nullptr) delete this->cameraTransformationBuffer;

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

		prepareCommandBuffer->endCommand();

		uint32_t imageCount = this->renderer->getSwapChain()->getImageCount();
		uint32_t height = this->renderer->getSwapChain()->getHeight();
		uint32_t width = this->renderer->getSwapChain()->getWidth();

		std::vector<NugieVulkan::Buffer*> forwardBuffers;
		forwardBuffers.emplace_back(this->vertexBuffer->getBuffer());
		forwardBuffers.emplace_back(this->referenceBuffer->getBuffer());

		for (uint32_t imageIndex = 0; imageIndex < imageCount; imageIndex++) {
			for (uint32_t frameIndex = 0; frameIndex < NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT; frameIndex++) {
				auto commandBuffer = this->renderer->beginRecordRenderCommand(frameIndex, imageIndex);
				auto swapChainImage = this->renderer->getSwapChain()->getswapChainImages()[imageIndex];

				this->forwardSubRenderer->beginRenderPass(commandBuffer, imageIndex);
				this->forwardPassRenderer->render(commandBuffer, { this->forwardDescSet->getDescriptorSets(frameIndex) }, forwardBuffers, this->indexBuffer->getBuffer(), this->indexBuffer->size());
				this->forwardSubRenderer->endRenderPass(commandBuffer);

				// -------------------------------------------------------------------------------------------------------------------

				this->rayGenRenderer->render(commandBuffer, { this->rayGenDescSet->getDescriptorSets(frameIndex) }, height / 8, width / 8, 1);

				// -------------------------------------------------------------------------------------------------------------------

				this->rayGenBuffer->getBuffer(frameIndex)->transitionBuffer(commandBuffer, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_SHADER_WRITE_BIT, VK_ACCESS_SHADER_READ_BIT);
				this->rayIntersectRenderer->render(commandBuffer, { this->rayIntersectDescSet->getDescriptorSets(frameIndex) }, height * width / 64, 1, 1);

				// -------------------------------------------------------------------------------------------------------------------

				this->rayIntersectBuffer->getBuffer(frameIndex)->transitionBuffer(commandBuffer, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_SHADER_WRITE_BIT, VK_ACCESS_SHADER_READ_BIT);
				this->rayHitRenderer->render(commandBuffer, { this->rayHitDescSet->getDescriptorSets(frameIndex) }, height / 8, width / 8, 1);

				// -------------------------------------------------------------------------------------------------------------------

				this->rayHitBuffer->getBuffer(frameIndex)->transitionBuffer(commandBuffer, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_SHADER_WRITE_BIT, VK_ACCESS_SHADER_READ_BIT);
				this->samplingRenderer->render(commandBuffer, { this->samplingDescSet->getDescriptorSets(frameIndex) }, height / 8, width / 8, 1);

				// -------------------------------------------------------------------------------------------------------------------

				this->resultImages[frameIndex]->transitionImageLayout(commandBuffer, VK_IMAGE_LAYOUT_GENERAL, VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_TRANSFER_BIT, VK_ACCESS_SHADER_WRITE_BIT, VK_ACCESS_TRANSFER_READ_BIT);
				swapChainImage->transitionImageLayout(commandBuffer, VK_IMAGE_LAYOUT_PRESENT_SRC_KHR, VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL, VK_PIPELINE_STAGE_TOP_OF_PIPE_BIT, VK_PIPELINE_STAGE_TRANSFER_BIT, 0, VK_ACCESS_TRANSFER_WRITE_BIT);

				this->resultImages[frameIndex]->copyImageToOther(commandBuffer, swapChainImage);

				this->resultImages[frameIndex]->transitionImageLayout(commandBuffer, VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL, VK_IMAGE_LAYOUT_GENERAL, VK_PIPELINE_STAGE_TRANSFER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_TRANSFER_READ_BIT, VK_ACCESS_SHADER_WRITE_BIT);
				swapChainImage->transitionImageLayout(commandBuffer, VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL, VK_IMAGE_LAYOUT_PRESENT_SRC_KHR, VK_PIPELINE_STAGE_TRANSFER_BIT, VK_PIPELINE_STAGE_BOTTOM_OF_PIPE_BIT, VK_ACCESS_TRANSFER_WRITE_BIT, 0);

				// -------------------------------------------------------------------------------------------------------------------
				
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

				this->rayTraceUbo.randomSeed = this->randomSeed;

				this->rayTraceUniformBuffer->writeGlobalData(frameIndex, this->rayTraceUbo);
				this->cameraTransformationBuffer->writeGlobalData(frameIndex, this->cameraTransformation);

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
		std::vector<uint32_t> indices;
		std::vector<Vertex> vertices;
		std::vector<Reference> references;
		std::vector<Object> objects;
		std::vector<BvhNode> bvhObjects;
		std::vector<Triangle> triangles;
		std::vector<Triangle> triangleLights;
		std::vector<BvhNode> bvhTriangles;
		
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

		references.emplace_back(Reference{ 1u, 0u });
		references.emplace_back(Reference{ 1u, 0u });
		references.emplace_back(Reference{ 1u, 0u });
		references.emplace_back(Reference{ 1u, 0u });

		indices.emplace_back(0u);
		indices.emplace_back(1u);
		indices.emplace_back(2u);

		indices.emplace_back(2u);
		indices.emplace_back(3u);
		indices.emplace_back(0u);

		curTris.clear();
		curTris.emplace_back(Triangle{ glm::uvec3{ 0u, 1u, 2u }, 1u });
		curTris.emplace_back(Triangle{ glm::uvec3{ 2u, 3u, 0u }, 1u });		

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

		references.emplace_back(Reference{ 2u, 1u });
		references.emplace_back(Reference{ 2u, 1u });
		references.emplace_back(Reference{ 2u, 1u });
		references.emplace_back(Reference{ 2u, 1u });

		indices.emplace_back(4u);
		indices.emplace_back(5u);
		indices.emplace_back(6u);

		indices.emplace_back(6u);
		indices.emplace_back(7u);
		indices.emplace_back(4u);

		curTris.clear();
		curTris.emplace_back(Triangle{ glm::uvec3{ 4u, 5u, 6u }, 2u });
		curTris.emplace_back(Triangle{ glm::uvec3{ 6u, 7u, 4u }, 2u });

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

		references.emplace_back(Reference{ 0u, 2u });
		references.emplace_back(Reference{ 0u, 2u });
		references.emplace_back(Reference{ 0u, 2u });
		references.emplace_back(Reference{ 0u, 2u });

		indices.emplace_back(8u);
		indices.emplace_back(9u);
		indices.emplace_back(10u);

		indices.emplace_back(10u);
		indices.emplace_back(11u);
		indices.emplace_back(8u);
		
		curTris.clear();
		curTris.emplace_back(Triangle{ glm::uvec3{ 8u, 9u, 10u }, 0u });
		curTris.emplace_back(Triangle{ glm::uvec3{ 10u, 11u, 8u }, 0u });

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

		references.emplace_back(Reference{ 0u, 3u });
		references.emplace_back(Reference{ 0u, 3u });
		references.emplace_back(Reference{ 0u, 3u });
		references.emplace_back(Reference{ 0u, 3u });

		indices.emplace_back(12u);
		indices.emplace_back(13u);
		indices.emplace_back(14u);

		indices.emplace_back(14u);
		indices.emplace_back(15u);
		indices.emplace_back(12u);
		
		curTris.clear();
		curTris.emplace_back(Triangle{ glm::uvec3{ 12u, 13u, 14u }, 0u });
		curTris.emplace_back(Triangle{ glm::uvec3{ 14u, 15u, 12u }, 0u });

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

		references.emplace_back(Reference{ 0u, 4u });
		references.emplace_back(Reference{ 0u, 4u });
		references.emplace_back(Reference{ 0u, 4u });
		references.emplace_back(Reference{ 0u, 4u });

		indices.emplace_back(16u);
		indices.emplace_back(17u);
		indices.emplace_back(18u);

		indices.emplace_back(18u);
		indices.emplace_back(19u);
		indices.emplace_back(16u);
		
		curTris.clear();
		curTris.emplace_back(Triangle{ glm::uvec3{ 16u, 17u, 18u }, 0u });
		curTris.emplace_back(Triangle{ glm::uvec3{ 18u, 19u, 16u }, 0u });

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
		curTris.emplace_back(Triangle{ glm::uvec3{ 20u, 21u, 22u }, 0u });
		curTris.emplace_back(Triangle{ glm::uvec3{ 22u, 23u, 20u }, 0u });

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

		this->rayTraceUbo.numLight = static_cast<uint32_t>(triangleLights.size());

		// ----------------------------------------------------------------------------		

		auto commandBuffer = this->renderer->beginRecordTransferCommand();

		this->indexBuffer = new ArrayBuffer<uint32_t>(this->device, VK_BUFFER_USAGE_INDEX_BUFFER_BIT, static_cast<uint32_t>(indices.size()));
		this->indexBuffer->replace(commandBuffer, indices);

		this->vertexBuffer = new ArrayBuffer<Vertex>(this->device, VK_BUFFER_USAGE_VERTEX_BUFFER_BIT | VK_BUFFER_USAGE_STORAGE_BUFFER_BIT, static_cast<uint32_t>(vertices.size()));
		this->vertexBuffer->replace(commandBuffer, vertices);

		this->referenceBuffer = new ArrayBuffer<Reference>(this->device, VK_BUFFER_USAGE_VERTEX_BUFFER_BIT, static_cast<uint32_t>(references.size()));
		this->referenceBuffer->replace(commandBuffer, references);
		
		this->objectBuffer = new ArrayBuffer<Object>(this->device, VK_BUFFER_USAGE_STORAGE_BUFFER_BIT, static_cast<uint32_t>(objects.size()));
		this->objectBuffer->replace(commandBuffer, objects);

		this->objectBvhBuffer = new ArrayBuffer<BvhNode>(this->device, VK_BUFFER_USAGE_STORAGE_BUFFER_BIT, static_cast<uint32_t>(bvhObjects.size()));
		this->objectBvhBuffer->replace(commandBuffer, bvhObjects);

		this->triangleBuffer = new ArrayBuffer<Triangle>(this->device, VK_BUFFER_USAGE_STORAGE_BUFFER_BIT, static_cast<uint32_t>(triangles.size()));
		this->triangleBuffer->replace(commandBuffer, triangles);

		this->triangleLightBuffer = new ArrayBuffer<Triangle>(this->device, VK_BUFFER_USAGE_STORAGE_BUFFER_BIT, static_cast<uint32_t>(triangleLights.size()));
		this->triangleLightBuffer->replace(commandBuffer, triangleLights);

		this->geometryBvhBuffer = new ArrayBuffer<BvhNode>(this->device, VK_BUFFER_USAGE_STORAGE_BUFFER_BIT, static_cast<uint32_t>(bvhTriangles.size()));
		this->geometryBvhBuffer->replace(commandBuffer, bvhTriangles);

		this->transformBuffer = new ArrayBuffer<Transformation>(this->device, VK_BUFFER_USAGE_STORAGE_BUFFER_BIT, static_cast<uint32_t>(transforms.size()));
		this->transformBuffer->replace(commandBuffer, transforms);

		this->materialBuffer = new ArrayBuffer<Material>(this->device, VK_BUFFER_USAGE_STORAGE_BUFFER_BIT, static_cast<uint32_t>(materials.size()));
		this->materialBuffer->replace(commandBuffer, materials);

		commandBuffer->endCommand();
		this->renderer->submitTransferCommand();
	}

	void App::initCamera(uint32_t width, uint32_t height) {
		glm::vec3 position = glm::vec3(278.0f, 278.0f, -800.0f);
		glm::vec3 target = glm::vec3(0.0f, 0.0f, 1.0f);
		glm::vec3 vup = glm::vec3(0.0f, 1.0f, 0.0f);

		float near = 0.1f;
		float far = 2000.0f;

		float theta = glm::radians(40.0f);
		float aspectRatio = static_cast<float>(width) / static_cast<float>(height);

		this->camera->setPerspectiveProjection(theta, aspectRatio, near, far);
		this->camera->setViewDirection(position, target, vup);

		this->cameraTransformation.view = this->camera->getViewMatrix();
		this->cameraTransformation.projection = this->camera->getProjectionMatrix();
		this->rayTraceUbo.imgSize = glm::uvec2{width, height};
	}

	void App::init() {
		uint32_t width = this->renderer->getSwapChain()->getWidth();
		uint32_t height = this->renderer->getSwapChain()->getHeight();
		uint32_t imageCount = static_cast<uint32_t>(this->renderer->getSwapChain()->getImageCount());
		VkSampleCountFlagBits msaaSample = this->device->getMSAASamples();

		this->initCamera(width, height);

		this->rayTraceUniformBuffer = new ObjectBuffer<RayTraceUbo>(this->device, VK_BUFFER_USAGE_UNIFORM_BUFFER_BIT);
		this->cameraTransformationBuffer = new ObjectBuffer<CameraTransformation>(this->device, VK_BUFFER_USAGE_UNIFORM_BUFFER_BIT);

		this->rayGenBuffer = new ManyArrayBuffer<Ray>(this->device, VK_BUFFER_USAGE_STORAGE_BUFFER_BIT, width * height);
		this->rayIntersectBuffer = new ManyArrayBuffer<Hit>(this->device, VK_BUFFER_USAGE_STORAGE_BUFFER_BIT, width * height);
		this->rayHitBuffer = new ManyArrayBuffer<Result>(this->device, VK_BUFFER_USAGE_STORAGE_BUFFER_BIT, width * height);

		std::vector<VkDescriptorImageInfo> resultImageInfos { NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT };
		this->resultImages.resize(NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT);

		for (uint32_t i = 0; i < NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT; i++) {
			this->resultImages[i] = new NugieVulkan::Image(this->device, width, height, 1, VK_SAMPLE_COUNT_1_BIT, VK_FORMAT_R16G16B16A16_SFLOAT,
        VK_IMAGE_TILING_OPTIMAL, VK_IMAGE_USAGE_STORAGE_BIT | VK_IMAGE_USAGE_TRANSFER_SRC_BIT, VMA_MEMORY_USAGE_AUTO, VMA_ALLOCATION_CREATE_DEDICATED_MEMORY_BIT, 
        VK_IMAGE_ASPECT_COLOR_BIT);

			resultImageInfos[i] = this->resultImages[i]->getDescriptorInfo(VK_IMAGE_LAYOUT_GENERAL);
		}

		this->forwardSubRenderer = SubRenderer::Builder(this->device, width, height, NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT)
			.addAttachment(AttachmentType::OUTPUT_SHADER, VK_FORMAT_R32G32B32A32_SFLOAT, 
				VK_IMAGE_LAYOUT_GENERAL, VK_SAMPLE_COUNT_1_BIT)
			.addAttachment(AttachmentType::OUTPUT_SHADER, VK_FORMAT_R32G32B32A32_SFLOAT, 
				VK_IMAGE_LAYOUT_GENERAL, VK_SAMPLE_COUNT_1_BIT)
			.addAttachment(AttachmentType::OUTPUT_SHADER, VK_FORMAT_R8_UINT,
				VK_IMAGE_LAYOUT_GENERAL, VK_SAMPLE_COUNT_1_BIT)
			.setDepthAttachment(AttachmentType::KEEPED, VK_FORMAT_D16_UNORM, 
				VK_IMAGE_LAYOUT_DEPTH_STENCIL_ATTACHMENT_OPTIMAL, VK_SAMPLE_COUNT_1_BIT)
			.build();

		this->forwardDescSet = DescriptorSet::Builder(this->device, this->renderer->getDescriptorPool(), NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT)
			.addBuffer(0, VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, VK_SHADER_STAGE_VERTEX_BIT, this->cameraTransformationBuffer->getInfo())
			.addBuffer(1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_VERTEX_BIT, this->transformBuffer->getInfo())
			.build();

		this->rayGenDescSet = DescriptorSet::Builder(this->device, this->renderer->getDescriptorPool(), NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT)
			.addImage(0, VK_DESCRIPTOR_TYPE_STORAGE_IMAGE, VK_SHADER_STAGE_COMPUTE_BIT, this->forwardSubRenderer->getAttachmentInfos(0)[0])
			.addImage(1, VK_DESCRIPTOR_TYPE_STORAGE_IMAGE, VK_SHADER_STAGE_COMPUTE_BIT, this->forwardSubRenderer->getAttachmentInfos(0)[1])
			.addBuffer(2, VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->rayTraceUniformBuffer->getInfo())
			.addBuffer(3, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->rayGenBuffer->getInfo())
			.addBuffer(4, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->triangleLightBuffer->getInfo())
			.addBuffer(5, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->vertexBuffer->getInfo())
			.build();

		this->rayIntersectDescSet = DescriptorSet::Builder(this->device, this->renderer->getDescriptorPool(), NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT)
			.addBuffer(0, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->rayIntersectBuffer->getInfo())
			.addBuffer(1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->rayGenBuffer->getInfo())
			.addBuffer(2, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->objectBvhBuffer->getInfo())
			.addBuffer(3, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->objectBuffer->getInfo())
			.addBuffer(4, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->geometryBvhBuffer->getInfo())
			.addBuffer(5, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->triangleBuffer->getInfo())
			.addBuffer(6, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->triangleLightBuffer->getInfo())
			.addBuffer(7, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->vertexBuffer->getInfo())
			.addBuffer(8, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->transformBuffer->getInfo())
			.build();

		this->rayHitDescSet = DescriptorSet::Builder(this->device, this->renderer->getDescriptorPool(), NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT)
			.addImage(0, VK_DESCRIPTOR_TYPE_STORAGE_IMAGE, VK_SHADER_STAGE_COMPUTE_BIT, this->forwardSubRenderer->getAttachmentInfos(0)[0])
			.addImage(1, VK_DESCRIPTOR_TYPE_STORAGE_IMAGE, VK_SHADER_STAGE_COMPUTE_BIT, this->forwardSubRenderer->getAttachmentInfos(0)[1])
			.addImage(2, VK_DESCRIPTOR_TYPE_STORAGE_IMAGE, VK_SHADER_STAGE_COMPUTE_BIT, this->forwardSubRenderer->getAttachmentInfos(0)[2])
			.addBuffer(3, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->rayHitBuffer->getInfo())
			.addBuffer(4, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->rayIntersectBuffer->getInfo())
			.addBuffer(5, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->triangleBuffer->getInfo())
			.addBuffer(6, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->vertexBuffer->getInfo())
			.addBuffer(7, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->materialBuffer->getInfo())
			.build();
		
		this->samplingDescSet = DescriptorSet::Builder(this->device, this->renderer->getDescriptorPool(), NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT)			
			.addImage(0, VK_DESCRIPTOR_TYPE_STORAGE_IMAGE, VK_SHADER_STAGE_COMPUTE_BIT, resultImageInfos)
			.addBuffer(1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->rayHitBuffer->getInfo())
			.build();

		this->forwardPassRenderer = new ForwardPassRenderSystem(this->device, { this->forwardDescSet->getDescSetLayout() }, this->forwardSubRenderer->getRenderPass(), "shader/forward.vert.spv", "shader/forward.frag.spv");
		this->rayGenRenderer = new ComputeRenderSystem(this->device, { this->rayGenDescSet->getDescSetLayout() }, "shader/ray_gen.comp.spv");
		this->rayIntersectRenderer = new ComputeRenderSystem(this->device, { this->rayIntersectDescSet->getDescSetLayout() }, "shader/ray_intersect.comp.spv");
		this->rayHitRenderer = new ComputeRenderSystem(this->device, { this->rayHitDescSet->getDescSetLayout() }, "shader/ray_hit.comp.spv");
		this->samplingRenderer = new ComputeRenderSystem(this->device, { this->samplingDescSet->getDescSetLayout() }, "shader/sampling.comp.spv");

		this->forwardPassRenderer->initialize();
		this->rayGenRenderer->initialize();
		this->rayIntersectRenderer->initialize();
		this->rayHitRenderer->initialize();
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