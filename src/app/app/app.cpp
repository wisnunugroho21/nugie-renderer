#include "app.hpp"

#include "../utils/load_model/load_model.hpp"
#include "../utils/bvh/bvh.hpp"
#include "../camera/camera.hpp"
#include "../utils/sort/morton.hpp"

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

		uint32_t width = this->renderer->getSwapChain()->getWidth();
		uint32_t height = this->renderer->getSwapChain()->getHeight();

		this->camera = new Camera(width, height);
		this->mouseController = new MouseController();
		this->keyboardController = new KeyboardController();

		this->loadObjects();
		this->init();
		this->recordCommand();
	}

	App::~App() {
		if (this->screenRayGenerationRenderer != nullptr) delete this->screenRayGenerationRenderer;
		if (this->rayIntersectionRenderer != nullptr) delete this->rayIntersectionRenderer;
		if (this->rayClosestHitRenderer != nullptr) delete this->rayClosestHitRenderer;

		if (this->renderer != nullptr) delete this->renderer;

		if (this->screenRayGenerationDescSet != nullptr) delete this->screenRayGenerationDescSet;
		if (this->rayIntersectionDescSet != nullptr) delete this->rayIntersectionDescSet;
		if (this->rayClosestHitDescSet != nullptr) delete this->rayClosestHitDescSet;

		if (this->vertexBuffer != nullptr) delete this->vertexBuffer;
		if (this->materialBuffer != nullptr) delete this->materialBuffer;
		if (this->transformationBuffer != nullptr) delete this->transformationBuffer;

		if (this->objectBuffer != nullptr) delete this->objectBuffer;
		if (this->objectBvhNodeBuffer != nullptr) delete this->objectBvhNodeBuffer;
		if (this->primitiveBuffer != nullptr) delete this->primitiveBuffer;
		if (this->primitiveBvhNodeBuffer != nullptr) delete this->primitiveBvhNodeBuffer;

		if (this->rayGenBuffer != nullptr) delete this->rayGenBuffer;
		if (this->rayBuffers != nullptr) delete this->rayBuffers;
		if (this->hitRecordBuffers != nullptr) delete this->hitRecordBuffers;
		
		for (auto &&resultImage : this->resultImages) {
			if (resultImage != nullptr) delete resultImage;
		}
		
		for (auto &&colorTexture : this->colorTextures) {
			if (colorTexture != nullptr) delete colorTexture;
		}

		if (this->device != nullptr) delete this->device;
		if (this->window != nullptr) delete this->window;

		if (this->mouseController != nullptr) delete this->mouseController;
		if (this->keyboardController != nullptr) delete this->keyboardController;
		if (this->camera != nullptr) delete this->camera;
	}

	void App::recordCommand() {
		uint32_t width = this->renderer->getSwapChain()->getWidth();
		uint32_t height = this->renderer->getSwapChain()->getHeight();

		auto prepareCommandBuffer = this->renderer->beginRecordPrepareCommand();
		for (auto &&colorTexture : this->colorTextures) {
			if (!colorTexture->hasBeenMipmapped()) {
				colorTexture->generateMipmap(prepareCommandBuffer);
			}
		}

		for (auto &&swapChainImage : this->renderer->getSwapChain()->getswapChainImages()) {
			swapChainImage->transitionImageLayout(prepareCommandBuffer, VK_IMAGE_LAYOUT_UNDEFINED, VK_IMAGE_LAYOUT_PRESENT_SRC_KHR,
				VK_PIPELINE_STAGE_TOP_OF_PIPE_BIT, VK_PIPELINE_STAGE_TOP_OF_PIPE_BIT, 0, 0);
		}

		for (auto &&resultImage : this->resultImages) {
			resultImage->transitionImageLayout(prepareCommandBuffer, VK_IMAGE_LAYOUT_UNDEFINED, VK_IMAGE_LAYOUT_GENERAL,
				VK_PIPELINE_STAGE_TOP_OF_PIPE_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, 0, 0);
		}

		prepareCommandBuffer->endCommand();

		uint32_t imageCount = static_cast<uint32_t>(this->renderer->getSwapChain()->getImageCount());

		for (uint32_t imageIndex = 0; imageIndex < imageCount; imageIndex++) {
			for (uint32_t frameIndex = 0; frameIndex < NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT; frameIndex++) {
				auto commandBuffer = this->renderer->beginRecordRenderCommand(frameIndex, imageIndex);
				auto swapChainImages = this->renderer->getSwapChain()->getswapChainImages()[imageIndex];

				// ------------------ Ray Gen ------------------

				this->screenRayGenerationRenderer->render(commandBuffer, { this->screenRayGenerationDescSet->getDescriptorSets(frameIndex) }, width / 8u, height / 4u, 1u);

				this->rayBuffers->getBuffer(frameIndex)->transitionBuffer(commandBuffer, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_SHADER_WRITE_BIT, VK_ACCESS_SHADER_READ_BIT);
				this->hitRecordBuffers->getBuffer(frameIndex)->transitionBuffer(commandBuffer, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_SHADER_READ_BIT, VK_ACCESS_SHADER_WRITE_BIT);

				// ------------------ Ray Intersection ------------------
				
				this->rayIntersectionRenderer->render(commandBuffer, { this->rayIntersectionDescSet->getDescriptorSets(frameIndex) }, width * height / 32u, 1u, 1u);

				this->rayBuffers->getBuffer(frameIndex)->transitionBuffer(commandBuffer, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_SHADER_READ_BIT, VK_ACCESS_SHADER_WRITE_BIT);
				this->hitRecordBuffers->getBuffer(frameIndex)->transitionBuffer(commandBuffer, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_SHADER_WRITE_BIT, VK_ACCESS_SHADER_READ_BIT);

				// ------------------ Ray Closest Hit ------------------
				
				this->rayClosestHitRenderer->render(commandBuffer, { this->rayClosestHitDescSet->getDescriptorSets(frameIndex) }, width / 8u, height / 4u, 1u);

				// ------------------ Present ------------------
				
				this->resultImages[frameIndex]->transitionImageLayout(commandBuffer, VK_IMAGE_LAYOUT_GENERAL, VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL, 
					VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_TRANSFER_BIT, VK_ACCESS_SHADER_WRITE_BIT, VK_ACCESS_TRANSFER_READ_BIT);
				
				swapChainImages->transitionImageLayout(commandBuffer, VK_IMAGE_LAYOUT_PRESENT_SRC_KHR, VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL, 
					VK_PIPELINE_STAGE_TOP_OF_PIPE_BIT, VK_PIPELINE_STAGE_TRANSFER_BIT, 0, VK_ACCESS_TRANSFER_WRITE_BIT);

				this->resultImages[frameIndex]->copyImageToOther(commandBuffer, swapChainImages);

				this->resultImages[frameIndex]->transitionImageLayout(commandBuffer, VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL, VK_IMAGE_LAYOUT_GENERAL, 
					VK_PIPELINE_STAGE_TRANSFER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_TRANSFER_READ_BIT, VK_ACCESS_SHADER_WRITE_BIT);

				swapChainImages->transitionImageLayout(commandBuffer, VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL, VK_IMAGE_LAYOUT_PRESENT_SRC_KHR, 
					VK_PIPELINE_STAGE_TRANSFER_BIT, VK_PIPELINE_STAGE_BOTTOM_OF_PIPE_BIT, VK_ACCESS_TRANSFER_WRITE_BIT, 0);

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

				if (this->cameraUpdateCount < NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT) {
					this->rayGenBuffer->writeGlobalData(frameIndex, this->rayGenData);
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
		glm::vec3 cameraPosition, cameraDirection;
		bool isMousePressed = false, isKeyboardPressed = false;

		uint32_t t = 0;

		for (uint32_t i = 0; i < NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT; i++) {
			this->rayGenBuffer->writeGlobalData(i, this->rayGenData);
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

				this->rayGenData.origin = cameraRay.origin;
				this->rayGenData.horizontal = cameraRay.horizontal;
				this->rayGenData.vertical = cameraRay.vertical;
				this->rayGenData.lowerLeftCorner = cameraRay.lowerLeftCorner;
				
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

	void App::singleThreadRun() {
		glm::vec3 cameraPosition, cameraDirection;
		bool isMousePressed = false, isKeyboardPressed = false;

		for (uint32_t i = 0; i < NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT; i++) {
			this->rayGenBuffer->writeGlobalData(i, this->rayGenData);
		}

		this->renderer->submitPrepareCommand();
		auto oldTime = std::chrono::high_resolution_clock::now();

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

			if ((isMousePressed || isKeyboardPressed)) {
				this->camera->setViewTransformation(cameraTransformation, 40.0f);
				CameraRay cameraRay = this->camera->getCameraRay();

				this->rayGenData.origin = cameraRay.origin;
				this->rayGenData.horizontal = cameraRay.horizontal;
				this->rayGenData.vertical = cameraRay.vertical;
				this->rayGenData.lowerLeftCorner = cameraRay.lowerLeftCorner;
				
				this->cameraUpdateCount = 0u;
			}

			if (this->renderer->acquireFrame()) {
				uint32_t frameIndex = this->renderer->getFrameIndex();

				if (this->cameraUpdateCount < NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT) {
					this->rayGenBuffer->writeGlobalData(frameIndex, this->rayGenData);
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

		vkDeviceWaitIdle(this->device->getLogicalDevice());
	}

	void App::loadObjects() {
		std::vector<Vertex> vertices;
		std::vector<Material> materials;
		std::vector<TransformComponent> transforms;

		std::vector<Object> objects;
		std::vector<BvhNode> objectBvhNodes;
		std::vector<Primitive> primitives;
		std::vector<BvhNode> primitiveBvhNodes;

		std::vector<BoundBox*> objectBoundBoxes;

		// ----------------------------------------------------------------------------

		// kanan
		transforms.emplace_back(TransformComponent{ glm::vec3(0.0f), glm::vec3(1.0f), glm::vec3(0.0f) });
		uint32_t transformIndex = static_cast<uint32_t>(transforms.size() - 1);
		
		objects.emplace_back(Object{ static_cast<uint32_t>(primitiveBvhNodes.size()), static_cast<uint32_t>(primitives.size()), transformIndex });
		uint32_t objectIndex = static_cast<uint32_t>(objects.size() - 1);

		vertices.emplace_back(Vertex{ glm::vec3{555.0f, 0.0f, 0.0f}, glm::vec3{0.0f} });
		vertices.emplace_back(Vertex{ glm::vec3{555.0f, 555.0f, 0.0f}, glm::vec3{0.0f} });
		vertices.emplace_back(Vertex{ glm::vec3{555.0f, 555.0f, 555.0f}, glm::vec3{0.0f} });
		vertices.emplace_back(Vertex{ glm::vec3{555.0f, 0.0f, 555.0f}, glm::vec3{0.0f} });

		auto rightWallPrimitives = std::vector<Primitive>();
		rightWallPrimitives.emplace_back(Primitive{ glm::uvec3(0u, 1u, 2u), 0u });
		rightWallPrimitives.emplace_back(Primitive{ glm::uvec3(2u, 3u, 0u), 0u });

		std::vector<BoundBox*> primitveBoundBoxes;
		for (size_t i = 0; i < rightWallPrimitives.size(); i++) {
			primitveBoundBoxes.emplace_back(new PrimitiveBoundBox(i + 1, &rightWallPrimitives[i], vertices));
		}
		
		for (auto &&primitveBvhNode : createBvh(primitveBoundBoxes)) {
			primitiveBvhNodes.emplace_back(primitveBvhNode);
		}

		for (auto &&primitive : rightWallPrimitives) {
			primitives.emplace_back(primitive);
		}

		objectBoundBoxes.emplace_back(new ObjectBoundBox{ static_cast<uint32_t>(objectBoundBoxes.size() + 1), &objects[objectIndex], rightWallPrimitives, &transforms[transformIndex], vertices });
		uint32_t boundBoxIndex = static_cast<uint32_t>(objectBoundBoxes.size() - 1);

		transforms[transformIndex].objectMaximum = objectBoundBoxes[boundBoxIndex]->getOriginalMax();
		transforms[transformIndex].objectMinimum = objectBoundBoxes[boundBoxIndex]->getOriginalMin();

		// ----------------------------------------------------------------------------

		/* auto vertexSize = static_cast<uint32_t>(vertices.size());
		auto loadedBuffer = loadObjModel("../assets/models/quad_model.obj", 0u, 0u);

		auto transformIndex = static_cast<uint32_t>(transforms.size());
		transforms.emplace_back(TransformComponent{ glm::vec3(0.0f, 0.0f, 0.0f), glm::vec3(100.0f), glm::vec3(glm::radians(0.0f)) });

		for (auto &&vertex : loadedBuffer.vertices) {
			vertices.emplace_back(vertex);
		}

		auto boundBoxIndex = static_cast<uint32_t>(objectBoundBoxes.size());

		objects.emplace_back(Object{ static_cast<uint32_t>(primitiveBvhNodes.size()), static_cast<uint32_t>(primitives.size()), transformIndex });
		objectBoundBoxes.emplace_back(new ObjectBoundBox(boundBoxIndex, &objects[boundBoxIndex], loadedBuffer.primitives, &transforms[transformIndex], vertices));

		for (auto &&primitive : loadedBuffer.primitives) {
			primitives.emplace_back(primitive);
		}

		std::vector<BoundBox*> primitveBoundBoxes;
		for (size_t i = 0; i < loadedBuffer.primitives.size(); i++) {
			primitveBoundBoxes.emplace_back(new PrimitiveBoundBox(i, &loadedBuffer.primitives[i], vertices));
		}
		
		for (auto &&primitveBvhNode : createBvh(primitveBoundBoxes)) {
			primitiveBvhNodes.emplace_back(primitveBvhNode);
		}

		transforms[transformIndex].objectMaximum = objectBoundBoxes[boundBoxIndex]->getOriginalMax();
		transforms[transformIndex].objectMinimum = objectBoundBoxes[boundBoxIndex]->getOriginalMin(); */

		// ----------------------------------------------------------------------------
		
		materials.emplace_back(Material{ glm::vec3{ 0.73f, 0.73f, 0.73f }, glm::vec3{ 0.0f, 0.0f, 0.0f }, 0u });
		materials.emplace_back(Material{ glm::vec3{ 0.12f, 0.45f, 0.15f }, glm::vec3{ 0.0f, 0.0f, 0.0f }, 0u });
		materials.emplace_back(Material{ glm::vec3{ 0.65f, 0.05f, 0.05f }, glm::vec3{ 0.0f, 0.0f, 0.0f }, 0u });
		materials.emplace_back(Material{ glm::vec3{ 0.0f, 0.0f, 0.0f }, glm::vec3{ 0.0f, 0.0f, 0.0f }, 0u });

		// ---------------------------------------------------------------------

		objectBvhNodes = createBvh(objectBoundBoxes);

		uint32_t width = this->renderer->getSwapChain()->getWidth();
		uint32_t height = this->renderer->getSwapChain()->getHeight();

		// ---------------------------------------------------------------------

		auto commandBuffer = this->renderer->beginRecordTransferCommand();

		this->vertexBuffer = new ArrayBuffer<Vertex>(this->device, VK_BUFFER_USAGE_STORAGE_BUFFER_BIT, static_cast<uint32_t>(vertices.size()));
		this->vertexBuffer->replace(commandBuffer, vertices);

		this->materialBuffer = new ArrayBuffer<Material>(this->device, VK_BUFFER_USAGE_STORAGE_BUFFER_BIT, static_cast<uint32_t>(materials.size()));
		this->materialBuffer->replace(commandBuffer, materials);

		this->transformationBuffer = new ArrayBuffer<Transformation>(this->device, VK_BUFFER_USAGE_STORAGE_BUFFER_BIT, static_cast<uint32_t>(transforms.size()));
		this->transformationBuffer->replace(commandBuffer, ConvertComponentToTransform(transforms));

		this->objectBuffer = new ArrayBuffer<Object>(this->device, VK_BUFFER_USAGE_STORAGE_BUFFER_BIT, static_cast<uint32_t>(objects.size()));
		this->objectBuffer->replace(commandBuffer, objects);

		this->objectBvhNodeBuffer = new ArrayBuffer<BvhNode>(this->device, VK_BUFFER_USAGE_STORAGE_BUFFER_BIT, static_cast<uint32_t>(objectBvhNodes.size()));
		this->objectBvhNodeBuffer->replace(commandBuffer, objectBvhNodes);

		this->primitiveBuffer = new ArrayBuffer<Primitive>(this->device, VK_BUFFER_USAGE_STORAGE_BUFFER_BIT, static_cast<uint32_t>(primitives.size()));
		this->primitiveBuffer->replace(commandBuffer, primitives);

		this->primitiveBvhNodeBuffer = new ArrayBuffer<BvhNode>(this->device, VK_BUFFER_USAGE_STORAGE_BUFFER_BIT, static_cast<uint32_t>(primitiveBvhNodes.size()));
		this->primitiveBvhNodeBuffer->replace(commandBuffer, primitiveBvhNodes);

		this->colorTextures.resize(1);
		this->colorTextures[0] = new Texture(this->device, commandBuffer, "../assets/textures/viking_room.png");

		commandBuffer->endCommand();
		this->renderer->submitTransferCommand();
	}

	void App::initCamera(uint32_t width, uint32_t height) {
		this->camera->setViewDirection(glm::vec3{278.0f, 278.0f, -800.0f}, glm::vec3{0.0f, 0.0f, 1.0f}, 40.0f);
		CameraRay cameraRay = this->camera->getCameraRay();
		
		this->rayGenData.origin = cameraRay.origin;
		this->rayGenData.horizontal = cameraRay.horizontal;
		this->rayGenData.vertical = cameraRay.vertical;
		this->rayGenData.lowerLeftCorner = cameraRay.lowerLeftCorner;
		this->rayGenData.screenSize = glm::uvec2{width, height};
	}

	void App::init() {
		uint32_t width = this->renderer->getSwapChain()->getWidth();
		uint32_t height = this->renderer->getSwapChain()->getHeight();
		uint32_t imageCount = static_cast<uint32_t>(this->renderer->getSwapChain()->getImageCount());
		VkSampleCountFlagBits msaaSample = this->device->getMSAASamples();

		this->initCamera(width, height);

		this->rayGenBuffer = new ObjectBuffer<RayGenData>(this->device, VK_BUFFER_USAGE_UNIFORM_BUFFER_BIT);
		this->rayBuffers = new ManyArrayBuffer<Ray>(this->device, VK_BUFFER_USAGE_STORAGE_BUFFER_BIT, width * height);
		this->hitRecordBuffers = new ManyArrayBuffer<HitRecord>(this->device, VK_BUFFER_USAGE_STORAGE_BUFFER_BIT, width * height);

		std::vector<VkDescriptorImageInfo> resultImageInfos;

		resultImageInfos.resize(NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT);
		this->resultImages.resize(NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT);

		for (uint32_t i = 0; i < NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT; i++) {
			this->resultImages[i] = new NugieVulkan::Image(this->device, width, height, 1, VK_SAMPLE_COUNT_1_BIT, VK_FORMAT_R8G8B8A8_UNORM,
        VK_IMAGE_TILING_OPTIMAL, VK_IMAGE_USAGE_STORAGE_BIT | VK_IMAGE_USAGE_TRANSFER_SRC_BIT, VMA_MEMORY_USAGE_AUTO, VMA_ALLOCATION_CREATE_DEDICATED_MEMORY_BIT, 
        VK_IMAGE_ASPECT_COLOR_BIT);

			resultImageInfos[i] = this->resultImages[i]->getDescriptorInfo(VK_IMAGE_LAYOUT_GENERAL);
		}

		this->screenRayGenerationDescSet = DescriptorSet::Builder(this->device, this->renderer->getDescriptorPool(), NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT)
			.addBuffer(0, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->rayBuffers->getInfo())
			.addBuffer(1, VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->rayGenBuffer->getInfo())
			.build();

		this->rayIntersectionDescSet = DescriptorSet::Builder(this->device, this->renderer->getDescriptorPool(), NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT)
			.addBuffer(0, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->hitRecordBuffers->getInfo())
			.addBuffer(1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->rayBuffers->getInfo())
			.addBuffer(2, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->objectBuffer->getInfo())
			.addBuffer(3, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->objectBvhNodeBuffer->getInfo())
			.addBuffer(4, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->primitiveBuffer->getInfo())
			.addBuffer(5, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->primitiveBvhNodeBuffer->getInfo())
			.addBuffer(6, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->vertexBuffer->getInfo())
			.addBuffer(7, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->transformationBuffer->getInfo())
			.build();

		this->rayClosestHitDescSet = DescriptorSet::Builder(this->device, this->renderer->getDescriptorPool(), NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT)
			.addImage(0, VK_DESCRIPTOR_TYPE_STORAGE_IMAGE, VK_SHADER_STAGE_COMPUTE_BIT, resultImageInfos)
			.addBuffer(1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->hitRecordBuffers->getInfo())
			.addBuffer(2, VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->rayGenBuffer->getInfo())
			.addBuffer(3, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->vertexBuffer->getInfo())
			.addBuffer(4, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->materialBuffer->getInfo())
			.addImage(5, VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER, VK_SHADER_STAGE_COMPUTE_BIT, this->colorTextures[0]->getDescriptorInfo())
			.build();

		this->screenRayGenerationRenderer = new ComputeRenderSystem(this->device, { this->screenRayGenerationDescSet->getDescSetLayout() }, "shader/screen_ray_generation.comp.spv");
		this->rayIntersectionRenderer = new ComputeRenderSystem(this->device, { this->rayIntersectionDescSet->getDescSetLayout() }, "shader/ray_intersection.comp.spv");
		this->rayClosestHitRenderer = new ComputeRenderSystem(this->device, { this->rayClosestHitDescSet->getDescSetLayout() }, "shader/ray_closest_hit.comp.spv");

		this->screenRayGenerationRenderer->initialize();
		this->rayIntersectionRenderer->initialize();
		this->rayClosestHitRenderer->initialize();
	}

	void App::resize() {
		uint32_t width = this->renderer->getSwapChain()->getWidth();
		uint32_t height = this->renderer->getSwapChain()->getHeight();
		uint32_t imageCount = static_cast<uint32_t>(this->renderer->getSwapChain()->getImageCount());
		VkSampleCountFlagBits msaaSample = this->device->getMSAASamples();

		this->renderer->resetCommandPool();

		std::vector<VkDescriptorImageInfo> resultImageInfos;
		resultImageInfos.resize(NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT);

		for (size_t i = 0; i < this->resultImages.size(); i++) {
			if (this->resultImages[i] != nullptr) delete this->resultImages[i];

			this->resultImages[i] = new NugieVulkan::Image(this->device, width, height, 1, VK_SAMPLE_COUNT_1_BIT, this->renderer->getSwapChain()->getSwapChainImageFormat(),
        VK_IMAGE_TILING_OPTIMAL, VK_IMAGE_USAGE_STORAGE_BIT | VK_IMAGE_USAGE_TRANSFER_SRC_BIT, VMA_MEMORY_USAGE_AUTO, VMA_ALLOCATION_CREATE_DEDICATED_MEMORY_BIT, 
        VK_IMAGE_ASPECT_COLOR_BIT);

			resultImageInfos[i] = this->resultImages[i]->getDescriptorInfo(VK_IMAGE_LAYOUT_GENERAL);
		}

		DescriptorSet::Overwriter(NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT)
			.addBuffer(0, this->rayBuffers->getInfo())
			.addBuffer(1, this->rayGenBuffer->getInfo())
			.overwrite(this->screenRayGenerationDescSet);

		DescriptorSet::Overwriter(NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT)
			.addBuffer(0, this->hitRecordBuffers->getInfo())
			.addBuffer(1, this->rayBuffers->getInfo())
			.addBuffer(2, this->objectBuffer->getInfo())
			.addBuffer(3, this->objectBvhNodeBuffer->getInfo())
			.addBuffer(4, this->primitiveBuffer->getInfo())
			.addBuffer(5, this->primitiveBvhNodeBuffer->getInfo())
			.addBuffer(6, this->vertexBuffer->getInfo())
			.addBuffer(7, this->transformationBuffer->getInfo())
			.overwrite(this->rayIntersectionDescSet);

		DescriptorSet::Overwriter(NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT)
			.addImage(0, resultImageInfos)
			.addBuffer(1, this->hitRecordBuffers->getInfo())
			.addBuffer(2, this->rayGenBuffer->getInfo())
			.addBuffer(3, this->vertexBuffer->getInfo())
			.addBuffer(4, this->materialBuffer->getInfo())
			.addImage(5, this->colorTextures[0]->getDescriptorInfo())
			.overwrite(this->rayClosestHitDescSet);

		this->rayGenData.screenSize = glm::uvec2{width, height};
		this->cameraUpdateCount = 0u;
		
		this->recordCommand();
	}
}