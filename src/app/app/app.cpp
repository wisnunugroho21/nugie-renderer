#include "app.hpp"

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

#include "../utils/sort/morton.hpp"

namespace NugieApp {
	App::App() {
		this->window = new NugieVulkan::Window(WIDTH, HEIGHT, APP_TITLE);
		this->device = new NugieVulkan::Device(this->window);
		this->renderer = new Renderer(this->window, this->device);

		this->camera = new Camera(WIDTH, HEIGHT);
		this->mouseController = new MouseController();
		this->keyboardController = new KeyboardController();

		this->loadObjects();
		this->init();
		this->recordCommand();
	}

	App::~App() {
		if (this->indirectShadeRender != nullptr) delete this->indirectShadeRender;
		if (this->directShadeRender != nullptr) delete this->directShadeRender;
		if (this->sunDirectShadeRender != nullptr) delete this->sunDirectShadeRender;
		if (this->integratorRender != nullptr) delete this->integratorRender;
		if (this->intersectObjectRender != nullptr) delete this->intersectObjectRender;
		if (this->intersectLightRender != nullptr) delete this->intersectLightRender;
		if (this->lightShadeRender != nullptr) delete this->lightShadeRender;
		if (this->missRender != nullptr) delete this->missRender;
		if (this->indirectSamplerRender != nullptr) delete this->indirectSamplerRender;
		if (this->directSamplerRender != nullptr) delete this->directSamplerRender;
		if (this->sunDirectSamplerRender != nullptr) delete this->sunDirectSamplerRender;
		if (this->samplingRayRender != nullptr) delete this->samplingRayRender;

		if (this->finalSubRenderer != nullptr) delete this->finalSubRenderer;

		if (this->renderer != nullptr) delete this->renderer;

		if (this->indirectShadeDescSet != nullptr) delete this->indirectShadeDescSet;
		if (this->directShadeDescSet != nullptr) delete this->directShadeDescSet;
		if (this->sunDirectShadeDescSet != nullptr) delete this->sunDirectShadeDescSet;
		if (this->integratorDescSet != nullptr) delete this->integratorDescSet;
		if (this->directIntersectObjectDescSet != nullptr) delete this->directIntersectObjectDescSet;
		if (this->directIntersectLightDescSet != nullptr) delete this->directIntersectLightDescSet;
		if (this->indirectIntersectObjectDescSet != nullptr) delete this->indirectIntersectObjectDescSet;
		if (this->indirectIntersectLightDescSet != nullptr) delete this->indirectIntersectLightDescSet;
		if (this->lightShadeDescSet != nullptr) delete this->lightShadeDescSet;
		if (this->missDescSet != nullptr) delete this->missDescSet;
		if (this->indirectSamplerDescSet != nullptr) delete this->indirectSamplerDescSet;
		if (this->directSamplerDescSet != nullptr) delete this->directSamplerDescSet;
		if (this->sunDirectSamplerDescSet != nullptr) delete this->sunDirectSamplerDescSet;
		if (this->samplingDescSet != nullptr) delete this->samplingDescSet;

		if (this->globalUniformBuffer != nullptr) delete this->globalUniformBuffer;

		if (this->objectRayDataBuffer != nullptr) delete this->objectRayDataBuffer;
		if (this->lightRayDataBuffer != nullptr) delete this->lightRayDataBuffer;
		if (this->directObjectHitRecordBuffer != nullptr) delete this->directObjectHitRecordBuffer;
		if (this->directLightHitRecordBuffer != nullptr) delete this->directLightHitRecordBuffer;
		if (this->indirectObjectHitRecordBuffer != nullptr) delete this->indirectObjectHitRecordBuffer;
		if (this->indirectLightHitRecordBuffer != nullptr) delete this->indirectLightHitRecordBuffer;
		if (this->directShadeShadeBuffer != nullptr) delete this->directShadeShadeBuffer;
		if (this->sunDirectShadeShadeBuffer != nullptr) delete this->sunDirectShadeShadeBuffer;
		if (this->indirectShadeShadeBuffer != nullptr) delete this->indirectShadeShadeBuffer;
		if (this->lightShadeBuffer != nullptr) delete this->lightShadeBuffer;
		if (this->missBuffer != nullptr) delete this->missBuffer;
		if (this->indirectSamplerBuffer != nullptr) delete this->indirectSamplerBuffer;
		if (this->indirectDataBuffer != nullptr) delete this->indirectDataBuffer;
		if (this->directDataBuffer != nullptr) delete this->directDataBuffer;

		if (this->primitiveBuffer != nullptr) delete this->primitiveBuffer;
		if (this->primitiveBvhBuffer != nullptr) delete this->primitiveBvhBuffer;
		if (this->objectBuffer != nullptr) delete this->objectBuffer;
		if (this->objectBvhBuffer != nullptr) delete this->objectBvhBuffer;
		if (this->lightBuffer != nullptr) delete this->lightBuffer;
		if (this->lightBvhBuffer != nullptr) delete this->lightBvhBuffer;
		if (this->rayTraceVertexBuffer != nullptr) delete this->rayTraceVertexBuffer;
		
		if (this->materialBuffer != nullptr) delete this->materialBuffer;
		if (this->transformationBuffer != nullptr) delete this->transformationBuffer;

		if (this->quadIndexBuffer != nullptr) delete this->quadIndexBuffer;
		if (this->quadVertexBuffer != nullptr) delete this->quadVertexBuffer;

		for (auto &&accumulateImage : this->accumulateImages) {
			if (accumulateImage != nullptr) delete accumulateImage;
		}

		for (auto &&indirectImage : this->indirectImages) {
			if (indirectImage != nullptr) delete indirectImage;
		}		

		if (this->device != nullptr) delete this->device;
		if (this->window != nullptr) delete this->window;

		if (this->mouseController != nullptr) delete this->mouseController;
		if (this->keyboardController != nullptr) delete this->keyboardController;
		if (this->camera != nullptr) delete this->camera;
	}

	void App::recordCommand() {
		auto prepareCommandBuffer = this->renderer->beginRecordPrepareCommand();
		
		for (auto &&indirectImage : this->indirectImages) {
			indirectImage->transitionImageLayout(prepareCommandBuffer, VK_IMAGE_LAYOUT_UNDEFINED, VK_IMAGE_LAYOUT_GENERAL,
				VK_PIPELINE_STAGE_TOP_OF_PIPE_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
				0, VK_ACCESS_SHADER_WRITE_BIT | VK_ACCESS_SHADER_READ_BIT);
		}

		for (auto &&accumulateImage : this->accumulateImages) {
			accumulateImage->transitionImageLayout(prepareCommandBuffer, VK_IMAGE_LAYOUT_UNDEFINED, VK_IMAGE_LAYOUT_GENERAL,
				VK_PIPELINE_STAGE_TOP_OF_PIPE_BIT, VK_PIPELINE_STAGE_FRAGMENT_SHADER_BIT, 
				0, VK_ACCESS_SHADER_READ_BIT | VK_ACCESS_SHADER_WRITE_BIT);
		}

		prepareCommandBuffer->endCommand();

		uint32_t imageCount = static_cast<uint32_t>(this->renderer->getSwapChain()->getImageCount());
		uint32_t height = this->renderer->getSwapChain()->getHeight();
		uint32_t width = this->renderer->getSwapChain()->getWidth();

		for (uint32_t imageIndex = 0; imageIndex < imageCount; imageIndex++) {
			for (uint32_t frameIndex = 0; frameIndex < NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT; frameIndex++) {
				auto commandBuffer = this->renderer->beginRecordRenderCommand(frameIndex, imageIndex);

				// ----------- Indirect Sampler -----------

				this->indirectSamplerRender->render(commandBuffer, { this->indirectSamplerDescSet->getDescriptorSets(frameIndex) }, (width * height) / 32u, 1u, 1u);

				this->objectRayDataBuffer->getBuffer(frameIndex)->transitionBuffer(commandBuffer, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_SHADER_WRITE_BIT, VK_ACCESS_SHADER_READ_BIT);
				this->lightRayDataBuffer->getBuffer(frameIndex)->transitionBuffer(commandBuffer, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_SHADER_WRITE_BIT, VK_ACCESS_SHADER_READ_BIT);
				this->indirectSamplerBuffer->getBuffer(frameIndex)->transitionBuffer(commandBuffer, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_SHADER_READ_BIT, VK_ACCESS_SHADER_WRITE_BIT | VK_ACCESS_SHADER_READ_BIT);

				// ----------- Intersect Object -----------

				this->intersectObjectRender->render(commandBuffer, { this->indirectIntersectObjectDescSet->getDescriptorSets(frameIndex) }, (width * height) / 32u, 1u, 1u);

				this->indirectObjectHitRecordBuffer->getBuffer(frameIndex)->transitionBuffer(commandBuffer, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_SHADER_WRITE_BIT, VK_ACCESS_SHADER_READ_BIT);
				this->objectRayDataBuffer->getBuffer(frameIndex)->transitionBuffer(commandBuffer, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_SHADER_READ_BIT, VK_ACCESS_SHADER_WRITE_BIT);
				
				// ----------- Intersect Light -----------

				this->intersectLightRender->render(commandBuffer, { this->indirectIntersectLightDescSet->getDescriptorSets(frameIndex) }, (width * height) / 32u, 1u, 1u);

				this->indirectLightHitRecordBuffer->getBuffer(frameIndex)->transitionBuffer(commandBuffer, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_SHADER_WRITE_BIT, VK_ACCESS_SHADER_READ_BIT);
				this->lightRayDataBuffer->getBuffer(frameIndex)->transitionBuffer(commandBuffer, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_SHADER_READ_BIT, VK_ACCESS_SHADER_WRITE_BIT);
				
				// ----------- Indirect Shade -----------

				this->indirectShadeRender->render(commandBuffer, { this->indirectShadeDescSet->getDescriptorSets(frameIndex) }, (width * height) / 32u, 1u, 1u);
				this->indirectShadeShadeBuffer->getBuffer(frameIndex)->transitionBuffer(commandBuffer, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_SHADER_WRITE_BIT, VK_ACCESS_SHADER_READ_BIT);

				// ----------- Light Shade -----------

				this->lightShadeRender->render(commandBuffer, { this->lightShadeDescSet->getDescriptorSets(frameIndex) }, (width * height) / 32u, 1u, 1u);
				this->lightShadeBuffer->getBuffer(frameIndex)->transitionBuffer(commandBuffer, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_SHADER_WRITE_BIT, VK_ACCESS_SHADER_READ_BIT);

				// ----------- Miss -----------

				this->missRender->render(commandBuffer, { this->missDescSet->getDescriptorSets(frameIndex) }, (width * height) / 32u, 1u, 1u);
				this->missBuffer->getBuffer(frameIndex)->transitionBuffer(commandBuffer, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_SHADER_WRITE_BIT, VK_ACCESS_SHADER_READ_BIT);

				// ----------- Direct Sampler -----------

				this->directSamplerRender->render(commandBuffer, { this->directSamplerDescSet->getDescriptorSets(frameIndex) }, (width * height) / 32u, 1u, 1u);
				
				this->directDataBuffer->getBuffer(frameIndex)->transitionBuffer(commandBuffer, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_SHADER_WRITE_BIT, VK_ACCESS_SHADER_READ_BIT);
				this->objectRayDataBuffer->getBuffer(frameIndex)->transitionBuffer(commandBuffer, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_SHADER_WRITE_BIT, VK_ACCESS_SHADER_READ_BIT);
				this->lightRayDataBuffer->getBuffer(frameIndex)->transitionBuffer(commandBuffer, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_SHADER_WRITE_BIT, VK_ACCESS_SHADER_READ_BIT);

				this->directObjectHitRecordBuffer->getBuffer(frameIndex)->transitionBuffer(commandBuffer, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_SHADER_READ_BIT, VK_ACCESS_SHADER_WRITE_BIT);
				this->directLightHitRecordBuffer->getBuffer(frameIndex)->transitionBuffer(commandBuffer, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_SHADER_READ_BIT, VK_ACCESS_SHADER_WRITE_BIT);

				// ----------- Intersect Object -----------

				this->intersectObjectRender->render(commandBuffer, { this->directIntersectObjectDescSet->getDescriptorSets(frameIndex) }, (width * height) / 32u, 1u, 1u);

				this->directObjectHitRecordBuffer->getBuffer(frameIndex)->transitionBuffer(commandBuffer, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_SHADER_WRITE_BIT, VK_ACCESS_SHADER_READ_BIT);
				this->objectRayDataBuffer->getBuffer(frameIndex)->transitionBuffer(commandBuffer, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_SHADER_READ_BIT, VK_ACCESS_SHADER_WRITE_BIT);

				// ----------- Intersect Light -----------

				this->intersectLightRender->render(commandBuffer, { this->directIntersectLightDescSet->getDescriptorSets(frameIndex) }, (width * height) / 32u, 1u, 1u);

				this->directLightHitRecordBuffer->getBuffer(frameIndex)->transitionBuffer(commandBuffer, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_SHADER_WRITE_BIT, VK_ACCESS_SHADER_READ_BIT);
				this->lightRayDataBuffer->getBuffer(frameIndex)->transitionBuffer(commandBuffer, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_SHADER_READ_BIT, VK_ACCESS_SHADER_WRITE_BIT);

				// ----------- Direct Shade -----------

				this->directShadeRender->render(commandBuffer, { this->directShadeDescSet->getDescriptorSets(frameIndex) }, (width * height) / 32u, 1u, 1u);

				this->directShadeShadeBuffer->getBuffer(frameIndex)->transitionBuffer(commandBuffer, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_SHADER_WRITE_BIT, VK_ACCESS_SHADER_READ_BIT);
				this->directObjectHitRecordBuffer->getBuffer(frameIndex)->transitionBuffer(commandBuffer, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_SHADER_READ_BIT, VK_ACCESS_SHADER_WRITE_BIT);
				this->directLightHitRecordBuffer->getBuffer(frameIndex)->transitionBuffer(commandBuffer, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_SHADER_READ_BIT, VK_ACCESS_SHADER_WRITE_BIT);
				this->directDataBuffer->getBuffer(frameIndex)->transitionBuffer(commandBuffer, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_SHADER_READ_BIT, VK_ACCESS_SHADER_WRITE_BIT);

				// ----------- Sun Direct Sampler -----------

				this->sunDirectSamplerRender->render(commandBuffer, { this->sunDirectSamplerDescSet->getDescriptorSets(frameIndex) }, (width * height) / 32u, 1u, 1u);
				
				this->directDataBuffer->getBuffer(frameIndex)->transitionBuffer(commandBuffer, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_SHADER_WRITE_BIT, VK_ACCESS_SHADER_READ_BIT);
				this->objectRayDataBuffer->getBuffer(frameIndex)->transitionBuffer(commandBuffer, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_SHADER_WRITE_BIT, VK_ACCESS_SHADER_READ_BIT);
				this->lightRayDataBuffer->getBuffer(frameIndex)->transitionBuffer(commandBuffer, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_SHADER_WRITE_BIT, VK_ACCESS_SHADER_READ_BIT);

				this->directObjectHitRecordBuffer->getBuffer(frameIndex)->transitionBuffer(commandBuffer, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_SHADER_READ_BIT, VK_ACCESS_SHADER_WRITE_BIT);
				this->directLightHitRecordBuffer->getBuffer(frameIndex)->transitionBuffer(commandBuffer, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_SHADER_READ_BIT, VK_ACCESS_SHADER_WRITE_BIT);

				this->indirectObjectHitRecordBuffer->getBuffer(frameIndex)->transitionBuffer(commandBuffer, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_SHADER_READ_BIT, VK_ACCESS_SHADER_WRITE_BIT);
				this->indirectLightHitRecordBuffer->getBuffer(frameIndex)->transitionBuffer(commandBuffer, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_SHADER_READ_BIT, VK_ACCESS_SHADER_WRITE_BIT);

				// ----------- Intersect Object -----------

				this->intersectObjectRender->render(commandBuffer, { this->directIntersectObjectDescSet->getDescriptorSets(frameIndex) }, (width * height) / 32u, 1u, 1u);

				this->directObjectHitRecordBuffer->getBuffer(frameIndex)->transitionBuffer(commandBuffer, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_SHADER_WRITE_BIT, VK_ACCESS_SHADER_READ_BIT);
				this->objectRayDataBuffer->getBuffer(frameIndex)->transitionBuffer(commandBuffer, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_SHADER_READ_BIT, VK_ACCESS_SHADER_WRITE_BIT);

				// ----------- Intersect Light -----------

				this->intersectLightRender->render(commandBuffer, { this->directIntersectLightDescSet->getDescriptorSets(frameIndex) }, (width * height) / 32u, 1u, 1u);

				this->directLightHitRecordBuffer->getBuffer(frameIndex)->transitionBuffer(commandBuffer, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_SHADER_WRITE_BIT, VK_ACCESS_SHADER_READ_BIT);
				this->lightRayDataBuffer->getBuffer(frameIndex)->transitionBuffer(commandBuffer, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_SHADER_READ_BIT, VK_ACCESS_SHADER_WRITE_BIT);

				// ----------- Sun Direct Shade -----------

				this->sunDirectShadeRender->render(commandBuffer, {  this->sunDirectShadeDescSet->getDescriptorSets(frameIndex) }, (width * height) / 32u, 1u, 1u);

				this->sunDirectShadeShadeBuffer->getBuffer(frameIndex)->transitionBuffer(commandBuffer, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_SHADER_WRITE_BIT, VK_ACCESS_SHADER_READ_BIT);
				this->directObjectHitRecordBuffer->getBuffer(frameIndex)->transitionBuffer(commandBuffer, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_SHADER_READ_BIT, VK_ACCESS_SHADER_WRITE_BIT);
				this->directLightHitRecordBuffer->getBuffer(frameIndex)->transitionBuffer(commandBuffer, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_SHADER_READ_BIT, VK_ACCESS_SHADER_WRITE_BIT);
				this->directDataBuffer->getBuffer(frameIndex)->transitionBuffer(commandBuffer, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_SHADER_READ_BIT, VK_ACCESS_SHADER_WRITE_BIT);

				// ----------- Integrator -----------

				this->integratorRender->render(commandBuffer, { this->integratorDescSet->getDescriptorSets(frameIndex) }, (width * height) / 32u, 1u, 1u);

				this->indirectSamplerBuffer->getBuffer(frameIndex)->transitionBuffer(commandBuffer, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_SHADER_WRITE_BIT | VK_ACCESS_SHADER_READ_BIT, VK_ACCESS_SHADER_READ_BIT);
				this->missBuffer->getBuffer(frameIndex)->transitionBuffer(commandBuffer, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_SHADER_READ_BIT, VK_ACCESS_SHADER_WRITE_BIT);
				this->lightShadeBuffer->getBuffer(frameIndex)->transitionBuffer(commandBuffer, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_SHADER_READ_BIT, VK_ACCESS_SHADER_WRITE_BIT);
				this->indirectShadeShadeBuffer->getBuffer(frameIndex)->transitionBuffer(commandBuffer, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_SHADER_READ_BIT, VK_ACCESS_SHADER_WRITE_BIT);
				this->directShadeShadeBuffer->getBuffer(frameIndex)->transitionBuffer(commandBuffer, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_SHADER_READ_BIT, VK_ACCESS_SHADER_WRITE_BIT);
				this->sunDirectShadeShadeBuffer->getBuffer(frameIndex)->transitionBuffer(commandBuffer, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_SHADER_READ_BIT, VK_ACCESS_SHADER_WRITE_BIT);

				// ----------- Final Sampling -----------

				this->indirectImages[frameIndex]->transitionImageLayout(commandBuffer, VK_IMAGE_LAYOUT_GENERAL, VK_IMAGE_LAYOUT_GENERAL,
					VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_FRAGMENT_SHADER_BIT,
					VK_ACCESS_SHADER_WRITE_BIT | VK_ACCESS_SHADER_READ_BIT, VK_ACCESS_SHADER_READ_BIT);

				this->finalSubRenderer->beginRenderPass(commandBuffer, imageIndex);
				this->samplingRayRender->render(commandBuffer, { this->samplingDescSet->getDescriptorSets(frameIndex) }, { this->quadVertexBuffer->getBuffer() }, this->quadIndexBuffer->getBuffer(), this->quadIndexBuffer->size());
				this->finalSubRenderer->endRenderPass(commandBuffer);

				this->indirectImages[frameIndex]->transitionImageLayout(commandBuffer, VK_IMAGE_LAYOUT_GENERAL, VK_IMAGE_LAYOUT_GENERAL,
					VK_PIPELINE_STAGE_FRAGMENT_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
					VK_ACCESS_SHADER_READ_BIT, VK_ACCESS_SHADER_WRITE_BIT | VK_ACCESS_SHADER_READ_BIT);

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

				this->globalUniformBuffer->writeGlobalData(frameIndex, this->globalUbo);
				this->renderer->submitRenderCommand();

				if (!this->renderer->presentFrame()) {
					this->resize();
					this->randomSeed = 0;

					continue;
				}				

				if (frameIndex + 1 == NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT) {
					this->randomSeed++;
					this->globalUbo.numLightsRandomSeed.y = this->randomSeed;
				}				
			}
		}
	}

	void App::run() {
		glm::vec3 cameraPosition;
		glm::vec2 cameraRotation;

		bool isMousePressed = false, isKeyboardPressed = false;

		uint32_t t = 0;

		for (uint32_t i = 0; i < NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT; i++) {
			this->globalUniformBuffer->writeGlobalData(i, this->globalUbo);
		}

		std::thread renderThread(&App::renderLoop, std::ref(*this));

		auto oldTime = std::chrono::high_resolution_clock::now();
		auto oldFpsTime = std::chrono::high_resolution_clock::now();

		while (!this->window->shouldClose()) {
			this->window->pollEvents();

			CameraTransformation cameraTransformation = this->camera->getCameraTransformation();

			isMousePressed = false;
			isKeyboardPressed = false;

			auto newTime = std::chrono::high_resolution_clock::now();
			float deltaTime = std::chrono::duration<float, std::chrono::seconds::period>(newTime - oldTime).count();
			oldTime = newTime;

			cameraTransformation = this->mouseController->rotateInPlaceXZ(this->window->getWindow(), deltaTime, cameraTransformation, &isMousePressed);
			cameraTransformation = this->keyboardController->moveInPlaceXZ(this->window->getWindow(), deltaTime, cameraTransformation, &isKeyboardPressed);

			if (isMousePressed || isKeyboardPressed) {
				this->camera->setViewTransformation(cameraTransformation, 40.0f);
				CameraRay cameraRay = this->camera->getCameraRay();

				this->globalUbo.origin = cameraRay.origin;
				this->globalUbo.horizontal = cameraRay.horizontal;
				this->globalUbo.vertical = cameraRay.vertical;
				this->globalUbo.lowerLeftCorner = cameraRay.lowerLeftCorner;
				
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
		std::vector<Object> objects;
		std::vector<BoundBox*> objectBoundBoxes{};

		std::vector<Primitive> primitives;
		std::vector<BvhNode> primitiveBvhNodes;

		std::vector<RayTraceVertex> vertices;

		std::vector<Material> materials;
		std::vector<TriangleLight> triangleLights;
		std::vector<TransformComponent> transformComponents{};

		// ----------------------------------------------------------------------------

		// kanan
		transformComponents.emplace_back(TransformComponent{ glm::vec3(0.0f), glm::vec3(1.0f), glm::vec3(0.0f) });
		uint32_t transformIndex = static_cast<uint32_t>(transformComponents.size() - 1);
		
		objects.emplace_back(Object{ static_cast<uint32_t>(primitiveBvhNodes.size()), static_cast<uint32_t>(primitives.size()), transformIndex });
		uint32_t objectIndex = static_cast<uint32_t>(objects.size() - 1);

		vertices.emplace_back(RayTraceVertex{ glm::vec3{555.0f, 0.0f, 0.0f}, glm::vec3{0.0f} });
		vertices.emplace_back(RayTraceVertex{ glm::vec3{555.0f, 555.0f, 0.0f}, glm::vec3{0.0f} });
		vertices.emplace_back(RayTraceVertex{ glm::vec3{555.0f, 555.0f, 555.0f}, glm::vec3{0.0f} });
		vertices.emplace_back(RayTraceVertex{ glm::vec3{555.0f, 0.0f, 555.0f}, glm::vec3{0.0f} });

		std::vector<Primitive> wallPrimitives;
		wallPrimitives.emplace_back(Primitive{ glm::uvec3(0u, 1u, 2u), 1u });
		wallPrimitives.emplace_back(Primitive{ glm::uvec3(2u, 3u, 0u), 1u });

		for (auto &&primitive : wallPrimitives) {
			primitives.emplace_back(primitive);
		}

		std::vector<BoundBox*> primitiveBoundBoxes;
		for (size_t i = 0; i < wallPrimitives.size(); i++) {
			primitiveBoundBoxes.emplace_back(new PrimitiveBoundBox(i, &wallPrimitives[i], vertices));
		}

		for (auto &&primitiveBvhNode : createBvh(primitiveBoundBoxes)) {
			primitiveBvhNodes.emplace_back(primitiveBvhNode);
		}

		objectBoundBoxes.emplace_back(new ObjectBoundBox{ static_cast<uint32_t>(objectBoundBoxes.size() + 1), &objects[objectIndex], wallPrimitives, &transformComponents[transformIndex], vertices });
		uint32_t boundBoxIndex = static_cast<uint32_t>(objectBoundBoxes.size() - 1);

		transformComponents[transformIndex].objectMaximum = objectBoundBoxes[boundBoxIndex]->getOriginalMax();
		transformComponents[transformIndex].objectMinimum = objectBoundBoxes[boundBoxIndex]->getOriginalMin();

		// ----------------------------------------------------------------------------
		
		// kiri
		transformComponents.emplace_back(TransformComponent{ glm::vec3(0.0f), glm::vec3(1.0f), glm::vec3(0.0f) });
		transformIndex = static_cast<uint32_t>(transformComponents.size() - 1);
		
		objects.emplace_back(Object{ static_cast<uint32_t>(primitiveBvhNodes.size()), static_cast<uint32_t>(primitives.size()), transformIndex });
		objectIndex = static_cast<uint32_t>(objects.size() - 1);

		vertices.emplace_back(RayTraceVertex{ glm::vec3{0.0f, 0.0f, 0.0f}, glm::vec3{0.0f} });
		vertices.emplace_back(RayTraceVertex{ glm::vec3{0.0f, 555.0f, 0.0f}, glm::vec3{0.0f} });
		vertices.emplace_back(RayTraceVertex{ glm::vec3{0.0f, 555.0f, 555.0f}, glm::vec3{0.0f} });
		vertices.emplace_back(RayTraceVertex{ glm::vec3{0.0f, 0.0f, 555.0f}, glm::vec3{0.0f} });

		wallPrimitives.clear();
		wallPrimitives.emplace_back(Primitive{ glm::uvec3(4u, 5u, 6u), 2u });
		wallPrimitives.emplace_back(Primitive{ glm::uvec3(6u, 7u, 4u), 2u });

		for (auto &&primitive : wallPrimitives) {
			primitives.emplace_back(primitive);
		}

		primitiveBoundBoxes.clear();
		for (size_t i = 0; i < wallPrimitives.size(); i++) {
			primitiveBoundBoxes.emplace_back(new PrimitiveBoundBox(i, &wallPrimitives[i], vertices));
		}

		for (auto &&primitiveBvhNode : createBvh(primitiveBoundBoxes)) {
			primitiveBvhNodes.emplace_back(primitiveBvhNode);
		}

		objectBoundBoxes.emplace_back(new ObjectBoundBox{ static_cast<uint32_t>(objectBoundBoxes.size() + 1), &objects[objectIndex], wallPrimitives, &transformComponents[transformIndex], vertices });
		boundBoxIndex = static_cast<uint32_t>(objectBoundBoxes.size() - 1);

		transformComponents[transformIndex].objectMaximum = objectBoundBoxes[boundBoxIndex]->getOriginalMax();
		transformComponents[transformIndex].objectMinimum = objectBoundBoxes[boundBoxIndex]->getOriginalMin();

		// ----------------------------------------------------------------------------
		
		// bawah
		transformComponents.emplace_back(TransformComponent{ glm::vec3(0.0f), glm::vec3(1.0f), glm::vec3(0.0f) });
		transformIndex = static_cast<uint32_t>(transformComponents.size() - 1);
		
		objects.emplace_back(Object{ static_cast<uint32_t>(primitiveBvhNodes.size()), static_cast<uint32_t>(primitives.size()), transformIndex });
		objectIndex = static_cast<uint32_t>(objects.size() - 1);

		wallPrimitives.clear();
		wallPrimitives.emplace_back(Primitive{ glm::uvec3(4u, 0u, 3u), 0u });
		wallPrimitives.emplace_back(Primitive{ glm::uvec3(3u, 7u, 4u), 0u });

		for (auto &&primitive : wallPrimitives) {
			primitives.emplace_back(primitive);
		}

		primitiveBoundBoxes.clear();
		for (size_t i = 0; i < wallPrimitives.size(); i++) {
			primitiveBoundBoxes.emplace_back(new PrimitiveBoundBox(i, &wallPrimitives[i], vertices));
		}

		for (auto &&primitiveBvhNode : createBvh(primitiveBoundBoxes)) {
			primitiveBvhNodes.emplace_back(primitiveBvhNode);
		}

		objectBoundBoxes.emplace_back(new ObjectBoundBox{ static_cast<uint32_t>(objectBoundBoxes.size() + 1), &objects[objectIndex], wallPrimitives, &transformComponents[transformIndex], vertices });
		boundBoxIndex = static_cast<uint32_t>(objectBoundBoxes.size() - 1);

		transformComponents[transformIndex].objectMaximum = objectBoundBoxes[boundBoxIndex]->getOriginalMax();
		transformComponents[transformIndex].objectMinimum = objectBoundBoxes[boundBoxIndex]->getOriginalMin();

		// ----------------------------------------------------------------------------
		
		// atas
		transformComponents.emplace_back(TransformComponent{ glm::vec3(0.0f), glm::vec3(1.0f), glm::vec3(0.0f) });
		transformIndex = static_cast<uint32_t>(transformComponents.size() - 1);
		
		objects.emplace_back(Object{ static_cast<uint32_t>(primitiveBvhNodes.size()), static_cast<uint32_t>(primitives.size()), transformIndex });
		objectIndex = static_cast<uint32_t>(objects.size() - 1);

		wallPrimitives.clear();
		wallPrimitives.emplace_back(Primitive{ glm::uvec3(5u, 1u, 2u), 0u });
		wallPrimitives.emplace_back(Primitive{ glm::uvec3(2u, 6u, 5u), 0u });

		for (auto &&primitive : wallPrimitives) {
			primitives.emplace_back(primitive);
		}

		primitiveBoundBoxes.clear();
		for (size_t i = 0; i < wallPrimitives.size(); i++) {
			primitiveBoundBoxes.emplace_back(new PrimitiveBoundBox(i, &wallPrimitives[i], vertices));
		}

		for (auto &&primitiveBvhNode : createBvh(primitiveBoundBoxes)) {
			primitiveBvhNodes.emplace_back(primitiveBvhNode);
		}

		objectBoundBoxes.emplace_back(new ObjectBoundBox{ static_cast<uint32_t>(objectBoundBoxes.size() + 1), &objects[objectIndex], wallPrimitives, &transformComponents[transformIndex], vertices });
		boundBoxIndex = static_cast<uint32_t>(objectBoundBoxes.size() - 1);

		transformComponents[transformIndex].objectMaximum = objectBoundBoxes[boundBoxIndex]->getOriginalMax();
		transformComponents[transformIndex].objectMinimum = objectBoundBoxes[boundBoxIndex]->getOriginalMin();

		// ----------------------------------------------------------------------------
		
		// depan
		transformComponents.emplace_back(TransformComponent{ glm::vec3(0.0f), glm::vec3(1.0f), glm::vec3(0.0f) });
		transformIndex = static_cast<uint32_t>(transformComponents.size() - 1);
		
		objects.emplace_back(Object{ static_cast<uint32_t>(primitiveBvhNodes.size()), static_cast<uint32_t>(primitives.size()), transformIndex });
		objectIndex = static_cast<uint32_t>(objects.size() - 1);

		wallPrimitives.clear();
		wallPrimitives.emplace_back(Primitive{ glm::uvec3(7u, 6u, 2u), 0u });
		wallPrimitives.emplace_back(Primitive{ glm::uvec3(2u, 3u, 7u), 0u });

		for (auto &&primitive : wallPrimitives) {
			primitives.emplace_back(primitive);
		}

		primitiveBoundBoxes.clear();
		for (size_t i = 0; i < wallPrimitives.size(); i++) {
			primitiveBoundBoxes.emplace_back(new PrimitiveBoundBox(i, &wallPrimitives[i], vertices));
		}

		for (auto &&primitiveBvhNode : createBvh(primitiveBoundBoxes)) {
			primitiveBvhNodes.emplace_back(primitiveBvhNode);
		}

		objectBoundBoxes.emplace_back(new ObjectBoundBox{ static_cast<uint32_t>(objectBoundBoxes.size() + 1), &objects[objectIndex], wallPrimitives, &transformComponents[transformIndex], vertices });
		boundBoxIndex = static_cast<uint32_t>(objectBoundBoxes.size() - 1);

		transformComponents[transformIndex].objectMaximum = objectBoundBoxes[boundBoxIndex]->getOriginalMax();
		transformComponents[transformIndex].objectMinimum = objectBoundBoxes[boundBoxIndex]->getOriginalMin();

		// ----------------------------------------------------------------------------

		vertices.emplace_back(RayTraceVertex{ glm::vec3{213.0f, 554.0f, 227.0f}, glm::vec3{0.0f} });
		vertices.emplace_back(RayTraceVertex{ glm::vec3{343.0f, 554.0f, 227.0f}, glm::vec3{0.0f} });
		vertices.emplace_back(RayTraceVertex{ glm::vec3{343.0f, 554.0f, 332.0f}, glm::vec3{0.0f} });
		vertices.emplace_back(RayTraceVertex{ glm::vec3{213.0f, 554.0f, 332.0f}, glm::vec3{0.0f} });

		triangleLights.emplace_back(TriangleLight{ glm::uvec3(8u, 9u, 10u), glm::vec3(100.0f, 100.0f, 100.0f) });
		triangleLights.emplace_back(TriangleLight{ glm::uvec3(10u, 11u, 8u), glm::vec3(100.0f, 100.0f, 100.0f) });

		std::vector<BoundBox*> triangleLightBoundBoxes;
		for (size_t i = 0; i < triangleLights.size(); i++) {
			triangleLightBoundBoxes.emplace_back(new TriangleLightBoundBox{ static_cast<int>(i), &triangleLights[i], vertices });
		}

		// ----------------------------------------------------------------------------

		materials.emplace_back(Material{ glm::vec3(0.73f, 0.73f, 0.73f), 0.0f, 0.1f, 0.5f, 0u, 0u });
		materials.emplace_back(Material{ glm::vec3(0.12f, 0.45f, 0.15f), 0.0f, 0.1f, 0.5f, 0u, 0u });
		materials.emplace_back(Material{ glm::vec3(0.65f, 0.05f, 0.05f), 0.0f, 0.1f, 0.5f, 0u, 0u });
		materials.emplace_back(Material{ glm::vec3(0.0f, 0.0f, 0.0f), 0.0f, 0.1f, 0.5f, 0u, 0u });

		// ----------------------------------------------------------------------------

		std::vector<Transformation> transforms = ConvertRayComponentToRayTransform(transformComponents);
		std::vector<BvhNode> objectBvhNodes = createBvh(objectBoundBoxes);
		std::vector<BvhNode> triangleLightBvhNodes = createBvh(triangleLightBoundBoxes);

		// ----------------------------------------------------------------------------

		std::vector<Vertex> quadVertices;

		Vertex vertex1 { glm::vec3(-1.0f, -1.0f, 0.0f) };
		quadVertices.emplace_back(vertex1);

		Vertex vertex2 { glm::vec3(1.0f, -1.0f, 0.0f) };
		quadVertices.emplace_back(vertex2);

		Vertex vertex3 { glm::vec3(1.0f, 1.0f, 0.0f) };
		quadVertices.emplace_back(vertex3);

		Vertex vertex4 { glm::vec3(-1.0f, 1.0f, 0.0f) };
		quadVertices.emplace_back(vertex4);

		std::vector<uint32_t> quadIndices = {
			0, 1, 2, 2, 3, 0
		};

		// ----------------------------------------------------------------------------

		auto commandBuffer = this->renderer->beginRecordTransferCommand();

		this->objectBuffer = new ArrayBuffer<Object>(this->device, VK_BUFFER_USAGE_STORAGE_BUFFER_BIT, static_cast<uint32_t>(objects.size()));
		this->objectBuffer->replace(commandBuffer, objects);

		this->objectBvhBuffer = new ArrayBuffer<BvhNode>(this->device, VK_BUFFER_USAGE_STORAGE_BUFFER_BIT, static_cast<uint32_t>(objectBvhNodes.size()));
		this->objectBvhBuffer->replace(commandBuffer, objectBvhNodes);

		this->primitiveBuffer = new ArrayBuffer<Primitive>(this->device, VK_BUFFER_USAGE_STORAGE_BUFFER_BIT, static_cast<uint32_t>(primitives.size()));
		this->primitiveBuffer->replace(commandBuffer, primitives);

		this->primitiveBvhBuffer = new ArrayBuffer<BvhNode>(this->device, VK_BUFFER_USAGE_STORAGE_BUFFER_BIT, static_cast<uint32_t>(primitiveBvhNodes.size()));
		this->primitiveBvhBuffer->replace(commandBuffer, primitiveBvhNodes);

		this->lightBuffer = new ArrayBuffer<TriangleLight>(this->device, VK_BUFFER_USAGE_STORAGE_BUFFER_BIT, static_cast<uint32_t>(triangleLights.size()));
		this->lightBuffer->replace(commandBuffer, triangleLights);

		this->lightBvhBuffer = new ArrayBuffer<BvhNode>(this->device, VK_BUFFER_USAGE_STORAGE_BUFFER_BIT, static_cast<uint32_t>(objects.size()));
		this->lightBvhBuffer->replace(commandBuffer, triangleLightBvhNodes);	

		this->materialBuffer = new ArrayBuffer<Material>(this->device, VK_BUFFER_USAGE_STORAGE_BUFFER_BIT, static_cast<uint32_t>(materials.size()));
		this->materialBuffer->replace(commandBuffer, materials);

		this->transformationBuffer = new ArrayBuffer<Transformation>(this->device, VK_BUFFER_USAGE_STORAGE_BUFFER_BIT, static_cast<uint32_t>(transformComponents.size()));
		this->transformationBuffer->replace(commandBuffer, transforms);

		this->rayTraceVertexBuffer = new ArrayBuffer<RayTraceVertex>(this->device, VK_BUFFER_USAGE_STORAGE_BUFFER_BIT, static_cast<uint32_t>(vertices.size()));
		this->rayTraceVertexBuffer->replace(commandBuffer, vertices);

		this->quadIndexBuffer = new ArrayBuffer<uint32_t>(this->device, VK_BUFFER_USAGE_INDEX_BUFFER_BIT, static_cast<uint32_t>(quadIndices.size()));
		this->quadIndexBuffer->replace(commandBuffer, quadIndices);

		this->quadVertexBuffer = new ArrayBuffer<Vertex>(this->device, VK_BUFFER_USAGE_VERTEX_BUFFER_BIT, static_cast<uint32_t>(quadVertices.size()));
		this->quadVertexBuffer->replace(commandBuffer, quadVertices);

		commandBuffer->endCommand();
		this->renderer->submitTransferCommand();
	}

	void App::initCamera(uint32_t width, uint32_t height) {
		RayTraceUbo ubo{};

		this->camera->setViewDirection(glm::vec3{278.0f, 278.0f, -800.0f}, glm::vec3{0.0f, 0.0f, 1.0f}, 40.0f);
		CameraRay cameraRay = this->camera->getCameraRay();
		
		this->globalUbo.origin = cameraRay.origin;
		this->globalUbo.horizontal = cameraRay.horizontal;
		this->globalUbo.vertical = cameraRay.vertical;
		this->globalUbo.lowerLeftCorner = cameraRay.lowerLeftCorner;
		this->globalUbo.imgSize = glm::uvec2{width, height};
		this->globalUbo.numLightsRandomSeed = { this->numLights, 0u };

		float phi = glm::radians(45.0f);
		float theta = glm::radians(45.0f);

		float sunX = glm::sin(theta) * glm::cos(phi);
		float sunY = glm::sin(theta) * glm::sin(phi);
		float sunZ = glm::cos(theta);

		this->globalUbo.sunLight.direction = glm::normalize(glm::vec3(sunX, sunY, sunZ));
		this->globalUbo.sunLight.color = glm::vec3(0.0f, 0.0f, 0.0f);
		this->globalUbo.skyColor = glm::vec3(0.0f, 0.0f, 0.0f);
	}

	void App::init() {
		uint32_t width = this->renderer->getSwapChain()->getWidth();
		uint32_t height = this->renderer->getSwapChain()->getHeight();
		uint32_t imageCount = static_cast<uint32_t>(this->renderer->getSwapChain()->getImageCount());
		VkSampleCountFlagBits msaaSample = this->device->getMSAASamples();

		this->initCamera(width, height);
		this->globalUniformBuffer = new ObjectBuffer<RayTraceUbo>(this->device, VK_BUFFER_USAGE_UNIFORM_BUFFER_BIT);

		this->finalSubRenderer = SubRenderer::Builder(this->device, width, height, imageCount)
			.addAttachment(AttachmentType::KEEPED, this->renderer->getSwapChain()->getSwapChainImageFormat(), 
				VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL, msaaSample)
			.setDepthAttachment(AttachmentType::KEEPED, VK_FORMAT_D16_UNORM, 
				VK_IMAGE_LAYOUT_DEPTH_STENCIL_ATTACHMENT_OPTIMAL, msaaSample)
			.addResolvedAttachment(this->renderer->getSwapChain()->getswapChainImages(), AttachmentType::OUTPUT_STORED,
				this->renderer->getSwapChain()->getSwapChainImageFormat(), VK_IMAGE_LAYOUT_PRESENT_SRC_KHR)
			.build();

		std::vector<VkDescriptorImageInfo> indirectImageDescInfos;
		std::vector<VkDescriptorImageInfo> accumulateImageDescInfos;

		for (uint32_t i = 0; i < this->renderer->getSwapChain()->getImageCount(); i++) {
			NugieVulkan::Image* indirectImage = new NugieVulkan::Image(this->device, width, height, 1, VK_SAMPLE_COUNT_1_BIT, 
				VK_FORMAT_B8G8R8A8_UNORM, VK_IMAGE_TILING_OPTIMAL, VK_IMAGE_USAGE_STORAGE_BIT, VMA_MEMORY_USAGE_AUTO, 
				VMA_ALLOCATION_CREATE_DEDICATED_MEMORY_BIT, VK_IMAGE_ASPECT_COLOR_BIT);

			this->indirectImages.emplace_back(indirectImage);
			indirectImageDescInfos.emplace_back(indirectImage->getDescriptorInfo(VK_IMAGE_LAYOUT_GENERAL));

			NugieVulkan::Image* accumulateImage = new NugieVulkan::Image(this->device, width, height, 1, VK_SAMPLE_COUNT_1_BIT, 
				VK_FORMAT_B8G8R8A8_UNORM, VK_IMAGE_TILING_OPTIMAL, VK_IMAGE_USAGE_STORAGE_BIT, VMA_MEMORY_USAGE_AUTO, 
				VMA_ALLOCATION_CREATE_DEDICATED_MEMORY_BIT, VK_IMAGE_ASPECT_COLOR_BIT);

			this->accumulateImages.emplace_back(accumulateImage);
			accumulateImageDescInfos.emplace_back(accumulateImage->getDescriptorInfo(VK_IMAGE_LAYOUT_GENERAL));
		}

		this->objectRayDataBuffer = new ManyArrayBuffer<RayData>(this->device, VK_BUFFER_USAGE_STORAGE_BUFFER_BIT, width * height);
		this->lightRayDataBuffer = new ManyArrayBuffer<RayData>(this->device, VK_BUFFER_USAGE_STORAGE_BUFFER_BIT, width * height);
		this->directObjectHitRecordBuffer = new ManyArrayBuffer<HitRecord>(this->device, VK_BUFFER_USAGE_STORAGE_BUFFER_BIT, width * height);
		this->directLightHitRecordBuffer = new ManyArrayBuffer<HitRecord>(this->device, VK_BUFFER_USAGE_STORAGE_BUFFER_BIT, width * height);
		this->indirectObjectHitRecordBuffer = new ManyArrayBuffer<HitRecord>(this->device, VK_BUFFER_USAGE_STORAGE_BUFFER_BIT, width * height);
		this->indirectLightHitRecordBuffer = new ManyArrayBuffer<HitRecord>(this->device, VK_BUFFER_USAGE_STORAGE_BUFFER_BIT, width * height);
		this->directShadeShadeBuffer = new ManyArrayBuffer<DirectShadeRecord>(this->device, VK_BUFFER_USAGE_STORAGE_BUFFER_BIT, width * height);
		this->sunDirectShadeShadeBuffer = new ManyArrayBuffer<DirectShadeRecord>(this->device, VK_BUFFER_USAGE_STORAGE_BUFFER_BIT, width * height);
		this->indirectShadeShadeBuffer = new ManyArrayBuffer<IndirectShadeRecord>(this->device, VK_BUFFER_USAGE_STORAGE_BUFFER_BIT, width * height);
		this->lightShadeBuffer = new ManyArrayBuffer<LightShadeRecord>(this->device, VK_BUFFER_USAGE_STORAGE_BUFFER_BIT, width * height);
		this->missBuffer = new ManyArrayBuffer<MissRecord>(this->device, VK_BUFFER_USAGE_STORAGE_BUFFER_BIT, width * height);
		this->indirectSamplerBuffer = new ManyArrayBuffer<IndirectSamplerData>(this->device, VK_BUFFER_USAGE_STORAGE_BUFFER_BIT, width * height);
		this->indirectDataBuffer = new ManyArrayBuffer<RenderResult>(this->device, VK_BUFFER_USAGE_STORAGE_BUFFER_BIT, width * height);
		this->directDataBuffer = new ManyArrayBuffer<DirectData>(this->device, VK_BUFFER_USAGE_STORAGE_BUFFER_BIT, width * height);

		this->indirectShadeDescSet = DescriptorSet::Builder(this->device, this->renderer->getDescriptorPool(), NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT)
			.addBuffer(0, VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->globalUniformBuffer->getInfo())
			.addBuffer(1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->indirectShadeShadeBuffer->getInfo())
			.addBuffer(2, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->indirectObjectHitRecordBuffer->getInfo())
			.addBuffer(3, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->indirectLightHitRecordBuffer->getInfo())
			.addBuffer(4, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->materialBuffer->getInfo())
			.build();

		this->directShadeDescSet = DescriptorSet::Builder(this->device, this->renderer->getDescriptorPool(), NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT)
			.addBuffer(0, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->directShadeShadeBuffer->getInfo())
			.addBuffer(1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->directObjectHitRecordBuffer->getInfo())
			.addBuffer(2, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->directLightHitRecordBuffer->getInfo())
			.addBuffer(3, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->directDataBuffer->getInfo())
			.addBuffer(4, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->materialBuffer->getInfo())
			.addBuffer(5, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->lightBuffer->getInfo())
			.addBuffer(6, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->rayTraceVertexBuffer->getInfo())
			.build();

		this->sunDirectShadeDescSet = DescriptorSet::Builder(this->device, this->renderer->getDescriptorPool(), NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT)
			.addBuffer(0, VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->globalUniformBuffer->getInfo())
			.addBuffer(1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->sunDirectShadeShadeBuffer->getInfo())
			.addBuffer(2, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->directObjectHitRecordBuffer->getInfo())
			.addBuffer(3, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->directLightHitRecordBuffer->getInfo())
			.addBuffer(4, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->directDataBuffer->getInfo())
			.addBuffer(5, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->materialBuffer->getInfo())
			.build();

		this->integratorDescSet = DescriptorSet::Builder(this->device, this->renderer->getDescriptorPool(), NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT)
			.addImage(0, VK_DESCRIPTOR_TYPE_STORAGE_IMAGE, VK_SHADER_STAGE_COMPUTE_BIT, indirectImageDescInfos)
			.addBuffer(1, VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->globalUniformBuffer->getInfo())
			.addBuffer(2, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->indirectSamplerBuffer->getInfo())
			.addBuffer(3, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->indirectDataBuffer->getInfo())
			.addBuffer(4, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->missBuffer->getInfo())
			.addBuffer(5, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->lightShadeBuffer->getInfo())
			.addBuffer(6, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->indirectShadeShadeBuffer->getInfo())
			.addBuffer(7, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->directShadeShadeBuffer->getInfo())
			.addBuffer(8, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->sunDirectShadeShadeBuffer->getInfo())
			.build();

		this->directIntersectLightDescSet = DescriptorSet::Builder(this->device, this->renderer->getDescriptorPool(), NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT)
			.addBuffer(0, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->directLightHitRecordBuffer->getInfo())
			.addBuffer(1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->lightRayDataBuffer->getInfo())
			.addBuffer(2, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->lightBuffer->getInfo())
			.addBuffer(3, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->lightBvhBuffer->getInfo())
			.addBuffer(4, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->rayTraceVertexBuffer->getInfo())
			.build();

		this->directIntersectObjectDescSet = DescriptorSet::Builder(this->device, this->renderer->getDescriptorPool(), NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT)
			.addBuffer(0, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->directObjectHitRecordBuffer->getInfo())
			.addBuffer(1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->objectRayDataBuffer->getInfo())
			.addBuffer(2, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->objectBuffer->getInfo())
			.addBuffer(3, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->objectBvhBuffer->getInfo())
			.addBuffer(4, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->primitiveBuffer->getInfo())
			.addBuffer(5, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->primitiveBvhBuffer->getInfo())
			.addBuffer(6, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->rayTraceVertexBuffer->getInfo())
			.addBuffer(7, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->materialBuffer->getInfo())
			.addBuffer(8, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->transformationBuffer->getInfo())
			.build();

		this->indirectIntersectLightDescSet = DescriptorSet::Builder(this->device, this->renderer->getDescriptorPool(), NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT)
			.addBuffer(0, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->indirectLightHitRecordBuffer->getInfo())
			.addBuffer(1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->lightRayDataBuffer->getInfo())
			.addBuffer(2, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->lightBuffer->getInfo())
			.addBuffer(3, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->lightBvhBuffer->getInfo())
			.addBuffer(4, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->rayTraceVertexBuffer->getInfo())
			.build();

		this->indirectIntersectObjectDescSet = DescriptorSet::Builder(this->device, this->renderer->getDescriptorPool(), NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT)
			.addBuffer(0, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->indirectObjectHitRecordBuffer->getInfo())
			.addBuffer(1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->objectRayDataBuffer->getInfo())
			.addBuffer(2, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->objectBuffer->getInfo())
			.addBuffer(3, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->objectBvhBuffer->getInfo())
			.addBuffer(4, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->primitiveBuffer->getInfo())
			.addBuffer(5, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->primitiveBvhBuffer->getInfo())
			.addBuffer(6, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->rayTraceVertexBuffer->getInfo())
			.addBuffer(7, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->materialBuffer->getInfo())
			.addBuffer(8, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->transformationBuffer->getInfo())
			.build();

		this->lightShadeDescSet = DescriptorSet::Builder(this->device, this->renderer->getDescriptorPool(), NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT)
			.addBuffer(0, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->lightShadeBuffer->getInfo())
			.addBuffer(1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->indirectObjectHitRecordBuffer->getInfo())
			.addBuffer(2, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->indirectLightHitRecordBuffer->getInfo())
			.addBuffer(3, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->lightBuffer->getInfo())
			.addBuffer(4, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->rayTraceVertexBuffer->getInfo())
			.build();

		this->missDescSet = DescriptorSet::Builder(this->device, this->renderer->getDescriptorPool(), NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT)
			.addBuffer(0, VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->globalUniformBuffer->getInfo())
			.addBuffer(1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->missBuffer->getInfo())
			.addBuffer(2, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->indirectObjectHitRecordBuffer->getInfo())
			.addBuffer(3, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->indirectLightHitRecordBuffer->getInfo())
			.build();

		this->indirectSamplerDescSet = DescriptorSet::Builder(this->device, this->renderer->getDescriptorPool(), NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT)
			.addBuffer(0, VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->globalUniformBuffer->getInfo())
			.addBuffer(1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->objectRayDataBuffer->getInfo())
			.addBuffer(2, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->lightRayDataBuffer->getInfo())
			.addBuffer(3, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->indirectSamplerBuffer->getInfo())
			.build();

		this->directSamplerDescSet = DescriptorSet::Builder(this->device, this->renderer->getDescriptorPool(), NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT)
			.addBuffer(0, VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->globalUniformBuffer->getInfo())
			.addBuffer(1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->objectRayDataBuffer->getInfo())
			.addBuffer(2, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->lightRayDataBuffer->getInfo())
			.addBuffer(3, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->directDataBuffer->getInfo())
			.addBuffer(4, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->indirectObjectHitRecordBuffer->getInfo())
			.addBuffer(5, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->indirectLightHitRecordBuffer->getInfo())
			.addBuffer(6, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->lightBuffer->getInfo())
			.addBuffer(7, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->rayTraceVertexBuffer->getInfo())
			.build();

		this->sunDirectSamplerDescSet = DescriptorSet::Builder(this->device, this->renderer->getDescriptorPool(), NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT)
			.addBuffer(0, VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->globalUniformBuffer->getInfo())
			.addBuffer(1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->objectRayDataBuffer->getInfo())
			.addBuffer(2, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->lightRayDataBuffer->getInfo())
			.addBuffer(3, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->directDataBuffer->getInfo())
			.addBuffer(4, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->indirectObjectHitRecordBuffer->getInfo())
			.addBuffer(5, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->indirectLightHitRecordBuffer->getInfo())
			.build();

		this->samplingDescSet = DescriptorSet::Builder(this->device, this->renderer->getDescriptorPool(), NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT)
			.addImage(0, VK_DESCRIPTOR_TYPE_STORAGE_IMAGE, VK_SHADER_STAGE_FRAGMENT_BIT, indirectImageDescInfos)
			.addImage(1, VK_DESCRIPTOR_TYPE_STORAGE_IMAGE, VK_SHADER_STAGE_FRAGMENT_BIT, accumulateImageDescInfos)
			.addBuffer(2, VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, VK_SHADER_STAGE_FRAGMENT_BIT, this->globalUniformBuffer->getInfo())
			.build();

		this->indirectShadeRender = new ComputeRenderSystem(this->device, { this->indirectShadeDescSet->getDescSetLayout() }, "shader/indirect_shade.comp.spv");
		this->directShadeRender = new ComputeRenderSystem(this->device, { this->directShadeDescSet->getDescSetLayout() }, "shader/direct_shade.comp.spv");
		this->sunDirectShadeRender = new ComputeRenderSystem(this->device, { this->sunDirectSamplerDescSet->getDescSetLayout() }, "shader/sun_direct_shade.comp.spv");
		this->integratorRender = new ComputeRenderSystem(this->device, { this->integratorDescSet->getDescSetLayout() }, "shader/integrator.comp.spv");
		this->intersectLightRender = new ComputeRenderSystem(this->device, { this->directIntersectLightDescSet->getDescSetLayout() }, "shader/intersect_light.comp.spv");
		this->intersectObjectRender = new ComputeRenderSystem(this->device, { this->directIntersectObjectDescSet->getDescSetLayout() }, "shader/intersect_object.comp.spv");
		this->lightShadeRender = new ComputeRenderSystem(this->device, { this->lightShadeDescSet->getDescSetLayout() }, "shader/light_shade.comp.spv");
		this->missRender = new ComputeRenderSystem(this->device, { this->missDescSet->getDescSetLayout() }, "shader/miss.comp.spv");
		this->indirectSamplerRender = new ComputeRenderSystem(this->device, { this->indirectSamplerDescSet->getDescSetLayout() }, "shader/indirect_sampler.comp.spv");
		this->directSamplerRender = new ComputeRenderSystem(this->device, { this->directSamplerDescSet->getDescSetLayout() }, "shader/direct_sampler.comp.spv");
		this->sunDirectSamplerRender = new ComputeRenderSystem(this->device, { this->sunDirectSamplerDescSet->getDescSetLayout() }, "shader/sun_direct_sampler.comp.spv");
		this->samplingRayRender = new GraphicRenderSystem(this->device, { this->samplingDescSet->getDescSetLayout() }, this->finalSubRenderer->getRenderPass(), "shader/sampling.vert.spv", "shader/sampling.frag.spv");

		this->indirectShadeRender->initialize();
		this->directShadeRender->initialize();
		this->sunDirectShadeRender->initialize();
		this->integratorRender->initialize();
		this->intersectLightRender->initialize();
		this->intersectObjectRender->initialize();
		this->lightShadeRender->initialize();
		this->missRender->initialize();
		this->indirectSamplerRender->initialize();
		this->directSamplerRender->initialize();
		this->sunDirectSamplerRender->initialize();
		this->samplingRayRender->initialize();
	}

	void App::resize() {
		/* uint32_t width = this->renderer->getSwapChain()->getWidth();
		uint32_t height = this->renderer->getSwapChain()->getHeight();
		uint32_t imageCount = static_cast<uint32_t>(this->renderer->getSwapChain()->getImageCount());
		VkSampleCountFlagBits msaaSample = this->device->getMSAASamples();

		this->renderer->resetCommandPool();

		SubRenderer::Overwriter(this->device, width, height, imageCount)
			.addOutsideAttachment(this->renderer->getSwapChain()->getswapChainImages())
			.overwrite(this->finalSubRenderer);

		float aspectRatio = static_cast<float>(width) / static_cast<float>(height);
		this->camera->setAspect(aspectRatio);

		this->renderData.cameraTransformation.view = this->camera->getViewMatrix();
		this->renderData.cameraTransformation.projection = this->camera->getProjectionMatrix();
		this->renderData.tessellationData.tessellationScreenSizeFactorEdgeSize.x = width;
		this->renderData.tessellationData.tessellationScreenSizeFactorEdgeSize.y = height;

		this->cameraUpdateCount = 0u;
		
		this->recordCommand(); */
	}
}