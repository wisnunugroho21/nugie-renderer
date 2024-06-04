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

		this->init();
		this->loadObjects();		
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

		if (this->currentRayBuffer != nullptr) delete this->currentRayBuffer;
		if (this->rayBounceBuffer != nullptr) delete this->rayBounceBuffer;
		if (this->isHitBuffer != nullptr) delete this->isHitBuffer;
		if (this->hitLengthBuffer != nullptr) delete this->hitLengthBuffer;
		if (this->hitIndexBuffer != nullptr) delete this->hitIndexBuffer;
		if (this->hitTypeIndexBuffer != nullptr) delete this->hitTypeIndexBuffer;
		if (this->indirectIsScatteredBuffer != nullptr) delete this->indirectIsScatteredBuffer;
		if (this->indirectRadianceBuffer != nullptr) delete this->indirectRadianceBuffer;
		if (this->indirectPdfBuffer != nullptr) delete this->indirectPdfBuffer;

		if (this->scatteredRayBuffer != nullptr) delete this->scatteredRayBuffer;
		if (this->indirectNormalBuffer != nullptr) delete this->indirectNormalBuffer;
		if (this->indirectHitPositionBuffer != nullptr) delete this->indirectHitPositionBuffer;
		if (this->indirectMaterialIndexBuffer != nullptr) delete this->indirectMaterialIndexBuffer;
		if (this->directIsIlluminateBuffer != nullptr) delete this->directIsIlluminateBuffer;
		if (this->directRadianceBuffer != nullptr) delete this->directRadianceBuffer;
		if (this->directPdfBuffer != nullptr) delete this->directPdfBuffer;
		if (this->lightIsIlluminateBuffer != nullptr) delete this->lightIsIlluminateBuffer;
		if (this->lightRadianceBuffer != nullptr) delete this->lightRadianceBuffer;
		if (this->missIsMissBuffer != nullptr) delete this->missIsMissBuffer;
		if (this->missRadianceBuffer != nullptr) delete this->missRadianceBuffer;

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

		this->currentRayBuffer->initializeValue(prepareCommandBuffer);
		this->rayBounceBuffer->initializeValue(prepareCommandBuffer);
		this->isHitBuffer->initializeValue(prepareCommandBuffer);
		this->hitLengthBuffer->initializeValue(prepareCommandBuffer);
		this->hitIndexBuffer->initializeValue(prepareCommandBuffer);
		this->hitTypeIndexBuffer->initializeValue(prepareCommandBuffer);
		this->indirectIsScatteredBuffer->initializeValue(prepareCommandBuffer);
		this->indirectRadianceBuffer->initializeValue(prepareCommandBuffer);
		this->indirectPdfBuffer->initializeValue(prepareCommandBuffer);
		this->scatteredRayBuffer->initializeValue(prepareCommandBuffer);
		this->indirectNormalBuffer->initializeValue(prepareCommandBuffer);
		this->indirectHitPositionBuffer->initializeValue(prepareCommandBuffer);
		this->indirectMaterialIndexBuffer->initializeValue(prepareCommandBuffer);
		this->directIsIlluminateBuffer->initializeValue(prepareCommandBuffer);
		this->directRadianceBuffer->initializeValue(prepareCommandBuffer);
		this->directPdfBuffer->initializeValue(prepareCommandBuffer);
		this->lightIsIlluminateBuffer->initializeValue(prepareCommandBuffer);
		this->lightRadianceBuffer->initializeValue(prepareCommandBuffer);
		this->missIsMissBuffer->initializeValue(prepareCommandBuffer);
		this->missRadianceBuffer->initializeValue(prepareCommandBuffer);

		prepareCommandBuffer->endCommand();

		uint32_t imageCount = this->renderer->getSwapChain()->getImageCount();
		uint32_t height = this->renderer->getSwapChain()->getHeight();
		uint32_t width = this->renderer->getSwapChain()->getWidth();

		for (uint32_t imageIndex = 0; imageIndex < imageCount; imageIndex++) {
			for (uint32_t frameIndex = 0; frameIndex < NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT; frameIndex++) {
				auto commandBuffer = this->renderer->beginRecordRenderCommand(frameIndex, imageIndex);
				auto swapChainImage = this->renderer->getSwapChain()->getswapChainImages()[imageIndex];

				// -------------------------------------------------------------------------------------------------------------------

				this->indirectRayGenRenderer->render(commandBuffer, { this->indirectRayGenDescSet->getDescriptorSets(frameIndex) }, height / 8, width / 8, 1);
				this->currentRayBuffer->getBuffer(frameIndex)->transitionBuffer(commandBuffer, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_SHADER_WRITE_BIT, VK_ACCESS_SHADER_READ_BIT);

				// -------------------------------------------------------------------------------------------------------------------

				this->rayIntersectRenderer->render(commandBuffer, { this->rayIntersectDescSet->getDescriptorSets(frameIndex) }, height * width / 64, 1, 1);
				
				this->isHitBuffer->getBuffer(frameIndex)->transitionBuffer(commandBuffer, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_SHADER_WRITE_BIT, VK_ACCESS_SHADER_READ_BIT);
				this->hitLengthBuffer->getBuffer(frameIndex)->transitionBuffer(commandBuffer, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_SHADER_WRITE_BIT, VK_ACCESS_SHADER_READ_BIT);
				this->hitIndexBuffer->getBuffer(frameIndex)->transitionBuffer(commandBuffer, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_SHADER_WRITE_BIT, VK_ACCESS_SHADER_READ_BIT);
				this->hitTypeIndexBuffer->getBuffer(frameIndex)->transitionBuffer(commandBuffer, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_SHADER_WRITE_BIT, VK_ACCESS_SHADER_READ_BIT);

				// -------------------------------------------------------------------------------------------------------------------

				this->scatteredRayBuffer->getBuffer(frameIndex)->transitionBuffer(commandBuffer, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_SHADER_READ_BIT, VK_ACCESS_SHADER_WRITE_BIT);
				this->indirectRayHitRenderer->render(commandBuffer, { this->indirectRayHitDescSet->getDescriptorSets(frameIndex) }, height * width / 64, 1, 1);

				this->indirectIsScatteredBuffer->getBuffer(frameIndex)->transitionBuffer(commandBuffer, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_SHADER_WRITE_BIT, VK_ACCESS_SHADER_READ_BIT);
				this->indirectRadianceBuffer->getBuffer(frameIndex)->transitionBuffer(commandBuffer, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_SHADER_WRITE_BIT, VK_ACCESS_SHADER_READ_BIT);
				this->indirectPdfBuffer->getBuffer(frameIndex)->transitionBuffer(commandBuffer, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_SHADER_WRITE_BIT, VK_ACCESS_SHADER_READ_BIT);
				this->scatteredRayBuffer->getBuffer(frameIndex)->transitionBuffer(commandBuffer, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_SHADER_WRITE_BIT, VK_ACCESS_SHADER_READ_BIT);
				this->indirectNormalBuffer->getBuffer(frameIndex)->transitionBuffer(commandBuffer, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_SHADER_WRITE_BIT, VK_ACCESS_SHADER_READ_BIT);
				this->indirectHitPositionBuffer->getBuffer(frameIndex)->transitionBuffer(commandBuffer, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_SHADER_WRITE_BIT, VK_ACCESS_SHADER_READ_BIT);
				this->indirectMaterialIndexBuffer->getBuffer(frameIndex)->transitionBuffer(commandBuffer, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_SHADER_WRITE_BIT, VK_ACCESS_SHADER_READ_BIT);

				// -------------------------------------------------------------------------------------------------------------------

				this->lightRayHitRenderer->render(commandBuffer, { this->lightRayHitDescSet->getDescriptorSets(frameIndex) }, height * width / 64, 1, 1);
				this->lightIsIlluminateBuffer->getBuffer(frameIndex)->transitionBuffer(commandBuffer, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_SHADER_WRITE_BIT, VK_ACCESS_SHADER_READ_BIT);
				this->lightRadianceBuffer->getBuffer(frameIndex)->transitionBuffer(commandBuffer, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_SHADER_WRITE_BIT, VK_ACCESS_SHADER_READ_BIT);

				// -------------------------------------------------------------------------------------------------------------------

				this->missRayRenderer->render(commandBuffer, { this->missRayDescSet->getDescriptorSets(frameIndex) }, height * width / 64, 1, 1);
				this->missIsMissBuffer->getBuffer(frameIndex)->transitionBuffer(commandBuffer, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_SHADER_WRITE_BIT, VK_ACCESS_SHADER_READ_BIT);
				this->missRadianceBuffer->getBuffer(frameIndex)->transitionBuffer(commandBuffer, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_SHADER_WRITE_BIT, VK_ACCESS_SHADER_READ_BIT);

				// -------------------------------------------------------------------------------------------------------------------

				this->currentRayBuffer->getBuffer(frameIndex)->transitionBuffer(commandBuffer, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_SHADER_READ_BIT, VK_ACCESS_SHADER_WRITE_BIT);
				this->directRayGenRenderer->render(commandBuffer, { this->directRayGenDescSet->getDescriptorSets(frameIndex) }, height * width / 64, 1, 1);
				this->currentRayBuffer->getBuffer(frameIndex)->transitionBuffer(commandBuffer, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_SHADER_WRITE_BIT, VK_ACCESS_SHADER_READ_BIT);

				// -------------------------------------------------------------------------------------------------------------------

				this->isHitBuffer->getBuffer(frameIndex)->transitionBuffer(commandBuffer, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_SHADER_READ_BIT, VK_ACCESS_SHADER_WRITE_BIT);
				this->hitLengthBuffer->getBuffer(frameIndex)->transitionBuffer(commandBuffer, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_SHADER_READ_BIT, VK_ACCESS_SHADER_WRITE_BIT);
				this->hitIndexBuffer->getBuffer(frameIndex)->transitionBuffer(commandBuffer, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_SHADER_READ_BIT, VK_ACCESS_SHADER_WRITE_BIT);
				this->hitTypeIndexBuffer->getBuffer(frameIndex)->transitionBuffer(commandBuffer, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_SHADER_READ_BIT, VK_ACCESS_SHADER_WRITE_BIT);
				
				this->rayIntersectRenderer->render(commandBuffer, { this->rayIntersectDescSet->getDescriptorSets(frameIndex) }, height * width / 64, 1, 1);
				
				this->isHitBuffer->getBuffer(frameIndex)->transitionBuffer(commandBuffer, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_SHADER_WRITE_BIT, VK_ACCESS_SHADER_READ_BIT);
				this->hitLengthBuffer->getBuffer(frameIndex)->transitionBuffer(commandBuffer, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_SHADER_WRITE_BIT, VK_ACCESS_SHADER_READ_BIT);
				this->hitIndexBuffer->getBuffer(frameIndex)->transitionBuffer(commandBuffer, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_SHADER_WRITE_BIT, VK_ACCESS_SHADER_READ_BIT);
				this->hitTypeIndexBuffer->getBuffer(frameIndex)->transitionBuffer(commandBuffer, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_SHADER_WRITE_BIT, VK_ACCESS_SHADER_READ_BIT);

				// -------------------------------------------------------------------------------------------------------------------

				this->directRayHitRenderer->render(commandBuffer, { this->directRayHitDescSet->getDescriptorSets(frameIndex) }, height * width / 64, 1, 1);

				this->directIsIlluminateBuffer->getBuffer(frameIndex)->transitionBuffer(commandBuffer, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_SHADER_WRITE_BIT, VK_ACCESS_SHADER_READ_BIT);
				this->directRadianceBuffer->getBuffer(frameIndex)->transitionBuffer(commandBuffer, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_SHADER_WRITE_BIT, VK_ACCESS_SHADER_READ_BIT);
				this->directPdfBuffer->getBuffer(frameIndex)->transitionBuffer(commandBuffer, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_SHADER_WRITE_BIT, VK_ACCESS_SHADER_READ_BIT);

				// -------------------------------------------------------------------------------------------------------------------

				this->integratorTotalRadianceBuffer->getBuffer(frameIndex)->transitionBuffer(commandBuffer, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_SHADER_READ_BIT, VK_ACCESS_SHADER_READ_BIT | VK_ACCESS_SHADER_WRITE_BIT);
				this->integratorTotalIndirectBuffer->getBuffer(frameIndex)->transitionBuffer(commandBuffer, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_SHADER_READ_BIT, VK_ACCESS_SHADER_READ_BIT | VK_ACCESS_SHADER_WRITE_BIT);
				this->integratorPdfBuffer->getBuffer(frameIndex)->transitionBuffer(commandBuffer, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_SHADER_READ_BIT, VK_ACCESS_SHADER_READ_BIT | VK_ACCESS_SHADER_WRITE_BIT);
				this->rayBounceBuffer->getBuffer(frameIndex)->transitionBuffer(commandBuffer, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_SHADER_READ_BIT, VK_ACCESS_SHADER_READ_BIT | VK_ACCESS_SHADER_WRITE_BIT);

				this->integratorRenderer->render(commandBuffer, { this->integratorDescSet->getDescriptorSets(frameIndex) }, height * width / 64, 1, 1);

				this->integratorTotalRadianceBuffer->getBuffer(frameIndex)->transitionBuffer(commandBuffer, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_SHADER_READ_BIT | VK_ACCESS_SHADER_WRITE_BIT, VK_ACCESS_SHADER_READ_BIT);
				this->integratorTotalIndirectBuffer->getBuffer(frameIndex)->transitionBuffer(commandBuffer, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_SHADER_READ_BIT | VK_ACCESS_SHADER_WRITE_BIT, VK_ACCESS_SHADER_READ_BIT);
				this->integratorPdfBuffer->getBuffer(frameIndex)->transitionBuffer(commandBuffer, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_SHADER_READ_BIT | VK_ACCESS_SHADER_WRITE_BIT, VK_ACCESS_SHADER_READ_BIT);
				this->rayBounceBuffer->getBuffer(frameIndex)->transitionBuffer(commandBuffer, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_SHADER_READ_BIT | VK_ACCESS_SHADER_WRITE_BIT, VK_ACCESS_SHADER_READ_BIT);

				// -------------------------------------------------------------------------------------------------------------------

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
		glm::vec4 cameraPosition;
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

		vertices.emplace_back(Vertex{ glm::vec4{ 555.0f, 0.0f, 0.0f, 1.0f }, glm::vec4{ -1.0f, 0.0f, 0.0f, 0.0f } });
		vertices.emplace_back(Vertex{ glm::vec4{ 555.0f, 555.0f, 0.0f, 1.0f }, glm::vec4{ -1.0f, 0.0f, 0.0f, 0.0f } });
		vertices.emplace_back(Vertex{ glm::vec4{ 555.0f, 555.0f, 555.0f, 1.0f }, glm::vec4{ -1.0f, 0.0f, 0.0f, 0.0f } });
		vertices.emplace_back(Vertex{ glm::vec4{ 555.0f, 0.0f, 555.0f, 1.0f }, glm::vec4{ -1.0f, 0.0f, 0.0f, 0.0f } });

		curTris.clear();
		curTris.emplace_back(Triangle{ glm::uvec4{ 0u, 1u, 2u, 1u } });
		curTris.emplace_back(Triangle{ glm::uvec4{ 2u, 3u, 0u, 1u } });		

		transformComponents.emplace_back(TransformComponent{ glm::vec3(1.0f, 0.0f, 0.0f), glm::vec3(1.0f), glm::vec3(0.0f) });
		uint32_t transformIndex = static_cast<uint32_t>(transformComponents.size() - 1);

		objects.emplace_back(Object{ glm::uvec4{static_cast<uint32_t>(bvhTriangles.size()), static_cast<uint32_t>(triangles.size()), transformIndex, 0u } });
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
		
		vertices.emplace_back(Vertex{ glm::vec4{ 0.0f, 0.0f, 0.0f, 1.0f }, glm::vec4{ 1.0f, 0.0f, 0.0f, 0.0f } });
		vertices.emplace_back(Vertex{ glm::vec4{ 0.0f, 555.0f, 0.0f, 1.0f }, glm::vec4{ 1.0f, 0.0f, 0.0f, 0.0f } });
		vertices.emplace_back(Vertex{ glm::vec4{ 0.0f, 555.0f, 555.0f, 1.0f }, glm::vec4{ 1.0f, 0.0f, 0.0f, 0.0f } });
		vertices.emplace_back(Vertex{ glm::vec4{ 0.0f, 0.0f, 555.0f, 1.0f }, glm::vec4{ 1.0f, 0.0f, 0.0f, 0.0f } });

		curTris.clear();
		curTris.emplace_back(Triangle{ glm::uvec4{ 4u, 5u, 6u, 2u } });
		curTris.emplace_back(Triangle{ glm::uvec4{ 6u, 7u, 4u, 2u } });

		transformComponents.emplace_back(TransformComponent{ glm::vec3(0.0f), glm::vec3(1.0f), glm::vec3(0.0f) });
		transformIndex = static_cast<uint32_t>(transformComponents.size() - 1);

		objects.emplace_back(Object{ glm::uvec4{static_cast<uint32_t>(bvhTriangles.size()), static_cast<uint32_t>(triangles.size()), transformIndex, 0u } });
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

		vertices.emplace_back(Vertex{ glm::vec4{ 0.0f, 0.0f, 0.0f, 1.0f }, glm::vec4{ 0.0f, 1.0f, 0.0f, 0.0f } });
		vertices.emplace_back(Vertex{ glm::vec4{ 555.0f, 0.0f, 0.0f, 1.0f }, glm::vec4{ 0.0f, 1.0f, 0.0f, 0.0f } });
		vertices.emplace_back(Vertex{ glm::vec4{ 555.0f, 0.0f, 555.0f, 1.0f }, glm::vec4{ 0.0f, 1.0f, 0.0f, 0.0f } });
		vertices.emplace_back(Vertex{ glm::vec4{ 0.0f, 0.0f, 555.0f, 1.0f }, glm::vec4{ 0.0f, 1.0f, 0.0f, 0.0f } });
		
		curTris.clear();
		curTris.emplace_back(Triangle{ glm::uvec4{ 8u, 9u, 10u, 0u } });
		curTris.emplace_back(Triangle{ glm::uvec4{ 10u, 11u, 8u, 0u } });

		transformComponents.emplace_back(TransformComponent{ glm::vec3(0.0f), glm::vec3(1.0f), glm::vec3(0.0f) });
		transformIndex = static_cast<uint32_t>(transformComponents.size() - 1);

		objects.emplace_back(Object{ glm::uvec4{static_cast<uint32_t>(bvhTriangles.size()), static_cast<uint32_t>(triangles.size()), transformIndex, 0u } });
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

		vertices.emplace_back(Vertex{ glm::vec4{ 0.0f, 555.0f, 0.0f, 1.0f }, glm::vec4{ 0.0f, -1.0f, 0.0f, 0.0f } });
		vertices.emplace_back(Vertex{ glm::vec4{ 555.0f, 555.0f, 0.0f, 1.0f }, glm::vec4{ 0.0f, -1.0f, 0.0f, 0.0f } });
		vertices.emplace_back(Vertex{ glm::vec4{ 555.0f, 555.0f, 555.0f, 1.0f }, glm::vec4{ 0.0f, -1.0f, 0.0f, 0.0f } });
		vertices.emplace_back(Vertex{ glm::vec4{ 0.0f, 555.0f, 555.0f, 1.0f }, glm::vec4{ 0.0f, -1.0f, 0.0f, 0.0f } });
		
		curTris.clear();
		curTris.emplace_back(Triangle{ glm::uvec4{ 12u, 13u, 14u, 0u } });
		curTris.emplace_back(Triangle{ glm::uvec4{ 14u, 15u, 12u, 0u } });

		transformComponents.emplace_back(TransformComponent{ glm::vec3(0.0f), glm::vec3(1.0f), glm::vec3(0.0f) });
		transformIndex = static_cast<uint32_t>(transformComponents.size() - 1);

		objects.emplace_back(Object{ glm::uvec4{static_cast<uint32_t>(bvhTriangles.size()), static_cast<uint32_t>(triangles.size()), transformIndex, 0u } });
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

		vertices.emplace_back(Vertex{ glm::vec4{ 0.0f, 0.0f, 555.0f, 1.0f }, glm::vec4{ 0.0f, 0.0f, -1.0f, 0.0f } });
		vertices.emplace_back(Vertex{ glm::vec4{ 0.0f, 555.0f, 555.0f, 1.0f }, glm::vec4{ 0.0f, 0.0f, -1.0f, 0.0f } });
		vertices.emplace_back(Vertex{ glm::vec4{ 555.0f, 555.0f, 555.0f, 1.0f }, glm::vec4{ 0.0f, 0.0f, -1.0f, 0.0f } });
		vertices.emplace_back(Vertex{ glm::vec4{ 555.0f, 0.0f, 555.0f, 1.0f }, glm::vec4{ 0.0f, 0.0f, -1.0f, 0.0f } });
		
		curTris.clear();
		curTris.emplace_back(Triangle{ glm::uvec4{ 16u, 17u, 18u, 0u } });
		curTris.emplace_back(Triangle{ glm::uvec4{ 18u, 19u, 16u, 0u } });

		transformComponents.emplace_back(TransformComponent{ glm::vec3(0.0f), glm::vec3(1.0f), glm::vec3(0.0f) });
		transformIndex = static_cast<uint32_t>(transformComponents.size() - 1);

		objects.emplace_back(Object{ glm::uvec4{static_cast<uint32_t>(bvhTriangles.size()), static_cast<uint32_t>(triangles.size()), transformIndex, 0u } });
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

		vertices.emplace_back(Vertex{ glm::vec4{ 213.0f, 554.0f, 227.0f, 1.0f }, glm::vec4{ 0.0f, -1.0f, 0.0f, 0.0f } });
		vertices.emplace_back(Vertex{ glm::vec4{ 343.0f, 554.0f, 227.0f, 1.0f }, glm::vec4{ 0.0f, -1.0f, 0.0f, 0.0f } });
		vertices.emplace_back(Vertex{ glm::vec4{ 343.0f, 554.0f, 332.0f, 1.0f }, glm::vec4{ 0.0f, -1.0f, 0.0f, 0.0f } });
		vertices.emplace_back(Vertex{ glm::vec4{ 213.0f, 554.0f, 332.0f, 1.0f }, glm::vec4{ 0.0f, -1.0f, 0.0f, 0.0f } });
			
		curTris.clear();
		curTris.emplace_back(Triangle{ glm::uvec4{ 20u, 21u, 22u, 0u } });
		curTris.emplace_back(Triangle{ glm::uvec4{ 22u, 23u, 20u, 0u } });

		transformComponents.emplace_back(TransformComponent{ glm::vec3(0.0f), glm::vec3(1.0f), glm::vec3(0.0f) });
		transformIndex = static_cast<uint32_t>(transformComponents.size() - 1);

		objects.emplace_back(Object{ glm::uvec4{ static_cast<uint32_t>(bvhTriangles.size()), static_cast<uint32_t>(triangleLights.size()), transformIndex, 0u } });
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

		auto commandBuffer = this->renderer->beginRecordTransferCommand();

		this->objectBuffer->replace(commandBuffer, objects);
		this->objectBvhBuffer->replace(commandBuffer, bvhObjects);
		this->triangleBuffer->replace(commandBuffer, triangles);
		this->triangleLightBuffer->replace(commandBuffer, triangleLights);
		this->geometryBvhBuffer->replace(commandBuffer, bvhTriangles);		
		this->vertexBuffer->replace(commandBuffer, vertices);
		this->transformBuffer->replace(commandBuffer, transforms);
		this->materialBuffer->replace(commandBuffer, materials);

		uint32_t width = this->renderer->getSwapChain()->getWidth();
		uint32_t height = this->renderer->getSwapChain()->getHeight();

		commandBuffer->endCommand();
		this->renderer->submitTransferCommand();
	}

	void App::initCamera(uint32_t width, uint32_t height) {
		RayTraceUbo ubo{};

		this->camera->setViewDirection(glm::vec3{278.0f, 278.0f, -800.0f}, glm::vec3{0.0f, 0.0f, 1.0f}, 40.0f);
		CameraRay cameraRay = this->camera->getCameraRay();
		
		this->rayTraceUbo.origin = glm::vec4{ cameraRay.origin, 1.0f };
		this->rayTraceUbo.horizontal = glm::vec4{ cameraRay.horizontal, 1.0f };
		this->rayTraceUbo.vertical = glm::vec4{ cameraRay.vertical, 1.0f };
		this->rayTraceUbo.lowerLeftCorner = glm::vec4{ cameraRay.lowerLeftCorner, 1.0f };
		this->rayTraceUbo.imgSizeRandomSeedNumLight = glm::uvec4{ glm::uvec2{width, height}, 0u, 0u };
	}

	void App::init() {
		uint32_t width = this->renderer->getSwapChain()->getWidth();
		uint32_t height = this->renderer->getSwapChain()->getHeight();
		uint32_t imageCount = static_cast<uint32_t>(this->renderer->getSwapChain()->getImageCount());
		VkSampleCountFlagBits msaaSample = this->device->getMSAASamples();

		this->initCamera(width, height);

		this->rayTraceUniformBuffer = new ObjectBuffer<RayTraceUbo>(this->device, VK_BUFFER_USAGE_UNIFORM_BUFFER_BIT);

		this->currentRayBuffer = new ManyArrayBuffer<Ray>(this->device, VK_BUFFER_USAGE_STORAGE_BUFFER_BIT | VK_BUFFER_USAGE_TRANSFER_DST_BIT, width * height, false);
		this->rayBounceBuffer = new ManyArrayBuffer<uint32_t>(this->device, VK_BUFFER_USAGE_STORAGE_BUFFER_BIT | VK_BUFFER_USAGE_TRANSFER_DST_BIT, width * height, false);
		this->isHitBuffer = new ManyArrayBuffer<bool>(this->device, VK_BUFFER_USAGE_STORAGE_BUFFER_BIT | VK_BUFFER_USAGE_TRANSFER_DST_BIT, width * height, false);
		this->hitLengthBuffer = new ManyArrayBuffer<float>(this->device, VK_BUFFER_USAGE_STORAGE_BUFFER_BIT | VK_BUFFER_USAGE_TRANSFER_DST_BIT, width * height, false);
		this->hitIndexBuffer = new ManyArrayBuffer<uint32_t>(this->device, VK_BUFFER_USAGE_STORAGE_BUFFER_BIT | VK_BUFFER_USAGE_TRANSFER_DST_BIT, width * height, false);
		this->hitTypeIndexBuffer = new ManyArrayBuffer<uint32_t>(this->device, VK_BUFFER_USAGE_STORAGE_BUFFER_BIT | VK_BUFFER_USAGE_TRANSFER_DST_BIT, width * height, false);
		this->indirectIsScatteredBuffer = new ManyArrayBuffer<bool>(this->device, VK_BUFFER_USAGE_STORAGE_BUFFER_BIT | VK_BUFFER_USAGE_TRANSFER_DST_BIT, width * height, false);
		this->indirectRadianceBuffer = new ManyArrayBuffer<glm::vec4>(this->device, VK_BUFFER_USAGE_STORAGE_BUFFER_BIT | VK_BUFFER_USAGE_TRANSFER_DST_BIT, width * height, false);
		this->indirectPdfBuffer = new ManyArrayBuffer<float>(this->device, VK_BUFFER_USAGE_STORAGE_BUFFER_BIT | VK_BUFFER_USAGE_TRANSFER_DST_BIT, width * height, false);
		this->scatteredRayBuffer = new ManyArrayBuffer<Ray>(this->device, VK_BUFFER_USAGE_STORAGE_BUFFER_BIT | VK_BUFFER_USAGE_TRANSFER_DST_BIT, width * height, false);
		this->indirectNormalBuffer = new ManyArrayBuffer<glm::vec4>(this->device, VK_BUFFER_USAGE_STORAGE_BUFFER_BIT | VK_BUFFER_USAGE_TRANSFER_DST_BIT, width * height, false);
		this->indirectHitPositionBuffer = new ManyArrayBuffer<glm::vec4>(this->device, VK_BUFFER_USAGE_STORAGE_BUFFER_BIT | VK_BUFFER_USAGE_TRANSFER_DST_BIT, width * height, false);
		this->indirectMaterialIndexBuffer = new ManyArrayBuffer<uint32_t>(this->device, VK_BUFFER_USAGE_STORAGE_BUFFER_BIT | VK_BUFFER_USAGE_TRANSFER_DST_BIT, width * height, false);
		this->directIsIlluminateBuffer = new ManyArrayBuffer<bool>(this->device, VK_BUFFER_USAGE_STORAGE_BUFFER_BIT | VK_BUFFER_USAGE_TRANSFER_DST_BIT, width * height, false);
		this->directRadianceBuffer = new ManyArrayBuffer<glm::vec4>(this->device, VK_BUFFER_USAGE_STORAGE_BUFFER_BIT | VK_BUFFER_USAGE_TRANSFER_DST_BIT, width * height, false);
		this->directPdfBuffer = new ManyArrayBuffer<float>(this->device, VK_BUFFER_USAGE_STORAGE_BUFFER_BIT | VK_BUFFER_USAGE_TRANSFER_DST_BIT, width * height, false);
		this->lightIsIlluminateBuffer = new ManyArrayBuffer<bool>(this->device, VK_BUFFER_USAGE_STORAGE_BUFFER_BIT | VK_BUFFER_USAGE_TRANSFER_DST_BIT, width * height, false);
		this->lightRadianceBuffer = new ManyArrayBuffer<glm::vec4>(this->device, VK_BUFFER_USAGE_STORAGE_BUFFER_BIT | VK_BUFFER_USAGE_TRANSFER_DST_BIT, width * height, false);
		this->missIsMissBuffer = new ManyArrayBuffer<bool>(this->device, VK_BUFFER_USAGE_STORAGE_BUFFER_BIT | VK_BUFFER_USAGE_TRANSFER_DST_BIT, width * height, false);
		this->missRadianceBuffer = new ManyArrayBuffer<glm::vec4>(this->device, VK_BUFFER_USAGE_STORAGE_BUFFER_BIT | VK_BUFFER_USAGE_TRANSFER_DST_BIT, width * height, false);
		this->integratorTotalRadianceBuffer = new ManyArrayBuffer<glm::vec4>(this->device, VK_BUFFER_USAGE_STORAGE_BUFFER_BIT | VK_BUFFER_USAGE_TRANSFER_DST_BIT, width * height, false);
		this->integratorTotalIndirectBuffer = new ManyArrayBuffer<glm::vec4>(this->device, VK_BUFFER_USAGE_STORAGE_BUFFER_BIT | VK_BUFFER_USAGE_TRANSFER_DST_BIT, width * height, false);
		this->integratorPdfBuffer = new ManyArrayBuffer<float>(this->device, VK_BUFFER_USAGE_STORAGE_BUFFER_BIT | VK_BUFFER_USAGE_TRANSFER_DST_BIT, width * height, false);
		this->samplingFinalColorBuffer = new ManyArrayBuffer<glm::vec4>(this->device, VK_BUFFER_USAGE_STORAGE_BUFFER_BIT | VK_BUFFER_USAGE_TRANSFER_DST_BIT, width * height, false);
		this->samplingCountSampleBuffer = new ManyArrayBuffer<uint32_t>(this->device, VK_BUFFER_USAGE_STORAGE_BUFFER_BIT | VK_BUFFER_USAGE_TRANSFER_DST_BIT, width * height, false);

		this->objectBuffer = new ArrayBuffer<Object>(this->device, VK_BUFFER_USAGE_STORAGE_BUFFER_BIT, static_cast<uint32_t>(10));
		this->objectBvhBuffer = new ArrayBuffer<BvhNode>(this->device, VK_BUFFER_USAGE_STORAGE_BUFFER_BIT, static_cast<uint32_t>(15));
		this->triangleBuffer = new ArrayBuffer<Triangle>(this->device, VK_BUFFER_USAGE_STORAGE_BUFFER_BIT, static_cast<uint32_t>(15));
		this->triangleLightBuffer = new ArrayBuffer<Triangle>(this->device, VK_BUFFER_USAGE_STORAGE_BUFFER_BIT, static_cast<uint32_t>(5));
		this->geometryBvhBuffer = new ArrayBuffer<BvhNode>(this->device, VK_BUFFER_USAGE_STORAGE_BUFFER_BIT, static_cast<uint32_t>(20));
		this->vertexBuffer = new ArrayBuffer<Vertex>(this->device, VK_BUFFER_USAGE_STORAGE_BUFFER_BIT, static_cast<uint32_t>(30));
		this->transformBuffer = new ArrayBuffer<Transformation>(this->device, VK_BUFFER_USAGE_STORAGE_BUFFER_BIT, static_cast<uint32_t>(10));
		this->materialBuffer = new ArrayBuffer<Material>(this->device, VK_BUFFER_USAGE_STORAGE_BUFFER_BIT, static_cast<uint32_t>(5));

		std::vector<VkDescriptorImageInfo> resultImageInfos { NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT };
		this->resultImages.resize(NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT);

		for (uint32_t i = 0; i < NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT; i++) {
			this->resultImages[i] = new NugieVulkan::Image(this->device, width, height, 1, VK_SAMPLE_COUNT_1_BIT, VK_FORMAT_R32G32B32A32_SFLOAT,
        VK_IMAGE_TILING_OPTIMAL, VK_IMAGE_USAGE_STORAGE_BIT | VK_IMAGE_USAGE_TRANSFER_SRC_BIT, VMA_MEMORY_USAGE_AUTO, VMA_ALLOCATION_CREATE_DEDICATED_MEMORY_BIT, 
        VK_IMAGE_ASPECT_COLOR_BIT);

			resultImageInfos[i] = this->resultImages[i]->getDescriptorInfo(VK_IMAGE_LAYOUT_GENERAL);
		}

		this->indirectRayGenDescSet = DescriptorSet::Builder(this->device, this->renderer->getDescriptorPool(), NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT)
			.addBuffer(0, VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->rayTraceUniformBuffer->getInfo())
			.addBuffer(1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->currentRayBuffer->getInfo())
			.addBuffer(2, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->scatteredRayBuffer->getInfo())
			.addBuffer(3, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->rayBounceBuffer->getInfo())
			.build();

		this->rayIntersectDescSet = DescriptorSet::Builder(this->device, this->renderer->getDescriptorPool(), NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT)
			.addBuffer(0, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->isHitBuffer->getInfo())
			.addBuffer(1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->hitLengthBuffer->getInfo())
			.addBuffer(2, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->hitIndexBuffer->getInfo())
			.addBuffer(3, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->hitTypeIndexBuffer->getInfo())
			.addBuffer(4, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->currentRayBuffer->getInfo())
			.addBuffer(5, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->objectBvhBuffer->getInfo())
			.addBuffer(6, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->objectBuffer->getInfo())
			.addBuffer(7, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->geometryBvhBuffer->getInfo())
			.addBuffer(8, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->triangleBuffer->getInfo())
			.addBuffer(9, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->triangleLightBuffer->getInfo())
			.addBuffer(10, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->vertexBuffer->getInfo())
			.addBuffer(11, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->transformBuffer->getInfo())
			.build();

		this->indirectRayHitDescSet = DescriptorSet::Builder(this->device, this->renderer->getDescriptorPool(), NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT)
			.addBuffer(0, VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->rayTraceUniformBuffer->getInfo())
			.addBuffer(1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->indirectIsScatteredBuffer->getInfo())
			.addBuffer(2, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->indirectRadianceBuffer->getInfo())
			.addBuffer(3, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->indirectPdfBuffer->getInfo())
			.addBuffer(4, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->scatteredRayBuffer->getInfo())
			.addBuffer(5, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->indirectNormalBuffer->getInfo())
			.addBuffer(6, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->indirectHitPositionBuffer->getInfo())
			.addBuffer(7, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->indirectMaterialIndexBuffer->getInfo())
			.addBuffer(8, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->currentRayBuffer->getInfo())
			.addBuffer(9, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->isHitBuffer->getInfo())
			.addBuffer(10, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->hitLengthBuffer->getInfo())
			.addBuffer(11, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->hitIndexBuffer->getInfo())
			.addBuffer(12, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->hitTypeIndexBuffer->getInfo())
			.addBuffer(13, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->triangleBuffer->getInfo())
			.addBuffer(14, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->vertexBuffer->getInfo())
			.addBuffer(15, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->materialBuffer->getInfo())			
			.build();

		this->lightRayHitDescSet = DescriptorSet::Builder(this->device, this->renderer->getDescriptorPool(), NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT)
			.addBuffer(0, VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->rayTraceUniformBuffer->getInfo())
			.addBuffer(1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->lightIsIlluminateBuffer->getInfo())
			.addBuffer(2, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->lightRadianceBuffer->getInfo())
			.addBuffer(3, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->currentRayBuffer->getInfo())
			.addBuffer(4, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->isHitBuffer->getInfo())
			.addBuffer(5, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->hitLengthBuffer->getInfo())
			.addBuffer(6, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->hitIndexBuffer->getInfo())
			.addBuffer(7, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->hitTypeIndexBuffer->getInfo())
			.addBuffer(8, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->triangleLightBuffer->getInfo())
			.addBuffer(9, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->vertexBuffer->getInfo())			
			.build();

		this->missRayDescSet = DescriptorSet::Builder(this->device, this->renderer->getDescriptorPool(), NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT)
			.addBuffer(0, VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->rayTraceUniformBuffer->getInfo())
			.addBuffer(1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->missIsMissBuffer->getInfo())
			.addBuffer(2, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->missRadianceBuffer->getInfo())
			.addBuffer(3, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->isHitBuffer->getInfo())		
			.build();

		this->directRayGenDescSet = DescriptorSet::Builder(this->device, this->renderer->getDescriptorPool(), NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT)
			.addBuffer(0, VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->rayTraceUniformBuffer->getInfo())
			.addBuffer(1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->currentRayBuffer->getInfo())
			.addBuffer(2, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->indirectIsScatteredBuffer->getInfo())
			.addBuffer(3, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->indirectNormalBuffer->getInfo())
			.addBuffer(4, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->indirectHitPositionBuffer->getInfo())
			.addBuffer(5, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->triangleLightBuffer->getInfo())
			.addBuffer(6, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->vertexBuffer->getInfo())		
			.build();

		this->directRayHitDescSet = DescriptorSet::Builder(this->device, this->renderer->getDescriptorPool(), NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT)
			.addBuffer(0, VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->rayTraceUniformBuffer->getInfo())
			.addBuffer(1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->directIsIlluminateBuffer->getInfo())
			.addBuffer(2, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->directRadianceBuffer->getInfo())
			.addBuffer(3, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->directPdfBuffer->getInfo())
			.addBuffer(4, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->indirectNormalBuffer->getInfo())
			.addBuffer(5, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->indirectMaterialIndexBuffer->getInfo())
			.addBuffer(6, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->currentRayBuffer->getInfo())
			.addBuffer(7, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->isHitBuffer->getInfo())
			.addBuffer(8, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->hitLengthBuffer->getInfo())
			.addBuffer(9, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->hitIndexBuffer->getInfo())
			.addBuffer(10, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->hitTypeIndexBuffer->getInfo())
			.addBuffer(11, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->triangleLightBuffer->getInfo())
			.addBuffer(12, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->vertexBuffer->getInfo())
			.addBuffer(13, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->materialBuffer->getInfo())		
			.build();

		this->integratorDescSet = DescriptorSet::Builder(this->device, this->renderer->getDescriptorPool(), NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT)
			.addBuffer(0, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->integratorTotalRadianceBuffer->getInfo())
			.addBuffer(1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->integratorTotalIndirectBuffer->getInfo())
			.addBuffer(2, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->integratorPdfBuffer->getInfo())
			.addBuffer(3, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->rayBounceBuffer->getInfo())
			.addBuffer(4, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->indirectIsScatteredBuffer->getInfo())
			.addBuffer(5, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->indirectRadianceBuffer->getInfo())
			.addBuffer(6, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->indirectPdfBuffer->getInfo())
			.addBuffer(7, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->lightIsIlluminateBuffer->getInfo())
			.addBuffer(8, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->lightRadianceBuffer->getInfo())
			.addBuffer(9, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->directIsIlluminateBuffer->getInfo())
			.addBuffer(10, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->directRadianceBuffer->getInfo())
			.addBuffer(11, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->directPdfBuffer->getInfo())
			.addBuffer(12, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->missIsMissBuffer->getInfo())
			.addBuffer(13, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->missRadianceBuffer->getInfo())
			.build();
		
		this->samplingDescSet = DescriptorSet::Builder(this->device, this->renderer->getDescriptorPool(), NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT)			
			.addImage(0, VK_DESCRIPTOR_TYPE_STORAGE_IMAGE, VK_SHADER_STAGE_COMPUTE_BIT, resultImageInfos)
			.addBuffer(1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->samplingFinalColorBuffer->getInfo())
			.addBuffer(2, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->samplingCountSampleBuffer->getInfo())
			.addBuffer(3, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->integratorTotalRadianceBuffer->getInfo())
			.addBuffer(4, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->rayBounceBuffer->getInfo())
			.build();
		
		this->indirectRayGenRenderer = new ComputeRenderSystem(this->device, { this->indirectRayGenDescSet->getDescSetLayout() }, "shader/indirect_ray_gen.comp.spv");
		this->rayIntersectRenderer = new ComputeRenderSystem(this->device, { this->rayIntersectDescSet->getDescSetLayout() }, "shader/ray_intersect.comp.spv");
		this->indirectRayHitRenderer = new ComputeRenderSystem(this->device, { this->indirectRayHitDescSet->getDescSetLayout() }, "shader/indirect_ray_hit.comp.spv");
		this->lightRayHitRenderer = new ComputeRenderSystem(this->device, { this->lightRayHitDescSet->getDescSetLayout() }, "shader/light_ray_hit.comp.spv");
		this->missRayRenderer = new ComputeRenderSystem(this->device, { this->missRayDescSet->getDescSetLayout() }, "shader/ray_miss.comp.spv");
		this->directRayGenRenderer = new ComputeRenderSystem(this->device, { this->directRayGenDescSet->getDescSetLayout() }, "shader/direct_ray_gen.comp.spv");
		this->directRayHitRenderer = new ComputeRenderSystem(this->device, { this->directRayHitDescSet->getDescSetLayout() }, "shader/direct_ray_hit.comp.spv");
		this->integratorRenderer = new ComputeRenderSystem(this->device, { this->integratorDescSet->getDescSetLayout() }, "shader/integrator.comp.spv");
		this->samplingRenderer = new ComputeRenderSystem(this->device, { this->samplingDescSet->getDescSetLayout() }, "shader/sampling.comp.spv");

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