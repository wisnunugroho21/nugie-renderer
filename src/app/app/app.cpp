#include "app.hpp"

#include "../utils/load_model/load_model.hpp"

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
		this->mouseController = new MouseController();
		this->keyboardController = new KeyboardController();

		this->loadObjects();
		this->init();
		this->recordCommand();
	}

	App::~App() {
		if (this->forwardPassRenderer != nullptr) delete this->forwardPassRenderer;
		if (this->rayTraceRenderer != nullptr) delete this->rayTraceRenderer;

		if (this->forwardSubRenderer != nullptr) delete this->forwardSubRenderer;

		if (this->renderer != nullptr) delete this->renderer;

		if (this->forwardDescSet != nullptr) delete this->forwardDescSet;
		if (this->rayTraceDescSet != nullptr) delete this->rayTraceDescSet;

		if (this->forwardUniform != nullptr) delete this->forwardUniform;

		if (this->indexBuffer != nullptr) delete this->indexBuffer;
		if (this->positionBuffer != nullptr) delete this->positionBuffer;
		if (this->normalBuffer != nullptr) delete this->normalBuffer;
		if (this->textCoordBuffer != nullptr) delete this->textCoordBuffer;
		if (this->referenceBuffer != nullptr) delete this->referenceBuffer;
		if (this->materialBuffer != nullptr) delete this->materialBuffer;
		if (this->transformationBuffer != nullptr) delete this->transformationBuffer;
		if (this->spotLightBuffer != nullptr) delete this->spotLightBuffer;
		
		for (auto &&colorTexture : this->colorTextures) {
			if (colorTexture != nullptr) delete colorTexture;
		}

		for (auto &&rayTraceImage : this->rayTraceImages) {
			if (rayTraceImage != nullptr) delete rayTraceImage;
		}

		if (this->device != nullptr) delete this->device;
		if (this->window != nullptr) delete this->window;

		if (this->mouseController != nullptr) delete this->mouseController;
		if (this->keyboardController != nullptr) delete this->keyboardController;
		if (this->camera != nullptr) delete this->camera;
	}

	void App::recordCommand() {
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

		for (auto &&rayTraceImage : this->rayTraceImages) {
			rayTraceImage->transitionImageLayout(prepareCommandBuffer, VK_IMAGE_LAYOUT_UNDEFINED, VK_IMAGE_LAYOUT_GENERAL,
				VK_PIPELINE_STAGE_TOP_OF_PIPE_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, 0, 0);
		}

		prepareCommandBuffer->endCommand();

		std::vector<NugieVulkan::Buffer*> forwardBuffers;
		forwardBuffers.emplace_back(this->positionBuffer->getBuffer());
		forwardBuffers.emplace_back(this->normalBuffer->getBuffer());
		forwardBuffers.emplace_back(this->textCoordBuffer->getBuffer());
		forwardBuffers.emplace_back(this->referenceBuffer->getBuffer());

		uint32_t width = this->renderer->getSwapChain()->getWidth();
		uint32_t height = this->renderer->getSwapChain()->getHeight();
		uint32_t imageCount = static_cast<uint32_t>(this->renderer->getSwapChain()->getImageCount());

		for (uint32_t imageIndex = 0; imageIndex < imageCount; imageIndex++) {
			for (uint32_t frameIndex = 0; frameIndex < NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT; frameIndex++) {

				auto commandBuffer = this->renderer->beginRecordRenderCommand(frameIndex, imageIndex);
				auto swapChainImages = this->renderer->getSwapChain()->getswapChainImages()[imageIndex];

				this->forwardSubRenderer->beginRenderPass(commandBuffer, imageIndex);
				this->forwardPassRenderer->render(commandBuffer, { this->forwardDescSet->getDescriptorSets(frameIndex) }, forwardBuffers, this->indexBuffer->getBuffer(), this->indexBuffer->size());
				this->forwardSubRenderer->endRenderPass(commandBuffer);

				this->rayTraceRenderer->render(commandBuffer, { this->rayTraceDescSet->getDescriptorSets(frameIndex) }, width / 8, height / 4, 1);

				this->rayTraceImages[frameIndex]->transitionImageLayout(commandBuffer, VK_IMAGE_LAYOUT_GENERAL, VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL, 
					VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_TRANSFER_BIT, VK_ACCESS_SHADER_WRITE_BIT, VK_ACCESS_TRANSFER_READ_BIT);

				swapChainImages->transitionImageLayout(commandBuffer, VK_IMAGE_LAYOUT_PRESENT_SRC_KHR, VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL, 
					VK_PIPELINE_STAGE_TOP_OF_PIPE_BIT, VK_PIPELINE_STAGE_TRANSFER_BIT, 0, VK_ACCESS_TRANSFER_WRITE_BIT);

				this->rayTraceImages[frameIndex]->copyImageToOther(commandBuffer, swapChainImages);

				this->rayTraceImages[frameIndex]->transitionImageLayout(commandBuffer, VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL, VK_IMAGE_LAYOUT_GENERAL, 
					VK_PIPELINE_STAGE_TRANSFER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_TRANSFER_READ_BIT, VK_ACCESS_SHADER_WRITE_BIT);

				swapChainImages->transitionImageLayout(commandBuffer, VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL, VK_IMAGE_LAYOUT_PRESENT_SRC_KHR, 
					VK_PIPELINE_STAGE_TRANSFER_BIT, VK_PIPELINE_STAGE_BOTTOM_OF_PIPE_BIT, VK_ACCESS_TRANSFER_WRITE_BIT, 0);

				commandBuffer->endCommand();
			}
		}
	}

	void App::renderLoop() {
		this->renderer->submitPrepareCommand();

		auto oldTime = std::chrono::high_resolution_clock::now();
		while (this->isRendering) {
			if (this->renderer->acquireFrame()) {
				uint32_t frameIndex = this->renderer->getFrameIndex();

				if (this->cameraUpdateCount < NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT) {
					this->forwardUniform->writeGlobalData(frameIndex, this->forwardUbo);
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

			auto newTime = std::chrono::high_resolution_clock::now();
			this->frameTime = std::chrono::duration<float, std::chrono::seconds::period>(newTime - oldTime).count();
			oldTime = newTime;
		}
	}

	void App::run() {
		glm::vec3 cameraPosition, cameraDirection;
		bool isMousePressed = false, isKeyboardPressed = false;

		uint32_t t = 0;

		for (uint32_t i = 0; i < NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT; i++) {
			this->forwardUniform->writeGlobalData(i, this->forwardUbo);
		}

		std::thread renderThread(&App::renderLoop, std::ref(*this));
		auto oldTime = std::chrono::high_resolution_clock::now();

		while (!this->window->shouldClose()) {
			this->window->pollEvents();

			cameraPosition = this->camera->getPosition();
			cameraDirection = this->camera->getDirection();

			isMousePressed = false;
			isKeyboardPressed = false;

			auto newTime = std::chrono::high_resolution_clock::now();
			float deltaTime = std::chrono::duration<float, std::chrono::seconds::period>(newTime - oldTime).count();
			oldTime = newTime;

			cameraDirection = this->mouseController->rotateInPlaceXZ(this->window->getWindow(), deltaTime, cameraDirection, &isMousePressed);
			cameraPosition = this->keyboardController->moveInPlaceXZ(this->window->getWindow(), deltaTime, cameraPosition, cameraDirection, &isKeyboardPressed);

			if (isMousePressed || isKeyboardPressed) {
				this->camera->setViewDirection(cameraPosition, cameraDirection);
				this->forwardUbo.cameraTransforms = this->camera->getProjectionMatrix() * this->camera->getViewMatrix();
				
				this->cameraUpdateCount = 0u;
			}

			if (t == 10) {
				std::string appTitle = std::string(APP_TITLE) + std::string(" | FPS: ") + std::to_string((1.0f / this->frameTime));
				glfwSetWindowTitle(this->window->getWindow(), appTitle.c_str());

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
			this->forwardUniform->writeGlobalData(i, this->forwardUbo);
		}

		std::vector<NugieVulkan::Buffer*> forwardBuffers;
		forwardBuffers.emplace_back(this->positionBuffer->getBuffer());
		forwardBuffers.emplace_back(this->normalBuffer->getBuffer());
		forwardBuffers.emplace_back(this->textCoordBuffer->getBuffer());
		forwardBuffers.emplace_back(this->referenceBuffer->getBuffer());

		this->renderer->submitPrepareCommand();
		auto oldTime = std::chrono::high_resolution_clock::now();

		while (!this->window->shouldClose()) {
			this->window->pollEvents();

			cameraPosition = this->camera->getPosition();
			cameraDirection = this->camera->getDirection();

			isMousePressed = false;
			isKeyboardPressed = false;

			auto newTime = std::chrono::high_resolution_clock::now();
			float deltaTime = std::chrono::duration<float, std::chrono::seconds::period>(newTime - oldTime).count();
			oldTime = newTime;

			cameraDirection = this->mouseController->rotateInPlaceXZ(this->window->getWindow(), deltaTime, cameraDirection, &isMousePressed);
			cameraPosition = this->keyboardController->moveInPlaceXZ(this->window->getWindow(), deltaTime, cameraPosition, cameraDirection, &isKeyboardPressed);

			if ((isMousePressed || isKeyboardPressed)) {
				this->camera->setViewDirection(cameraPosition, cameraDirection);
				this->forwardUbo.cameraTransforms = this->camera->getProjectionMatrix() * this->camera->getViewMatrix();
				
				this->cameraUpdateCount = 0u;
			}

			if (this->renderer->acquireFrame()) {
				uint32_t frameIndex = this->renderer->getFrameIndex();

				if (this->cameraUpdateCount < NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT) {
					this->forwardUniform->writeGlobalData(frameIndex, this->forwardUbo);
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
		std::vector<Position> positions;
		std::vector<Normal> normals;
		std::vector<TextCoord> textCoords;
		std::vector<Reference> references;
		std::vector<Material> materials;
		std::vector<TransformComponent> transforms;
		std::vector<ShadowTransformation> shadowTransforms;
		std::vector<uint32_t> indices;
		std::vector<SpotLight> spotLights;

		// ----------------------------------------------------------------------------

		LoadedModel loadedBuffer = loadObjModel("../assets/models/viking_room.obj");

		auto positionSize = static_cast<uint32_t>(positions.size());
		for (auto &&index : loadedBuffer.indices) {
			indices.emplace_back(positionSize + index);
		}

		for (auto &&position : loadedBuffer.positions) {
			positions.emplace_back(position);
		}

		for (auto &&normal : loadedBuffer.normals) {
			normals.emplace_back(normal);
		}

		for (auto &&textCoord : loadedBuffer.textCoords) {
			textCoords.emplace_back(textCoord);
		}

		for (size_t i = 0; i < loadedBuffer.positions.size(); i++) {
			references.emplace_back(Reference{ 1, 0 });
		}

		transforms.emplace_back(TransformComponent{ glm::vec3(0.0f, 0.0f, 0.0f), glm::vec3(10.0f), glm::vec3(glm::radians(270.0f), glm::radians(90.0f), glm::radians(0.0f)) });

		// ----------------------------------------------------------------------------

		/* loadedBuffer = loadObjBuffer("../assets/models/quad_model.obj");

		positionSize = static_cast<uint32_t>(positions.size());
		for (auto &&index : loadedBuffer.indices) {
			indices.emplace_back(positionSize + index);
		}

		for (auto &&position : loadedBuffer.positions) {
			positions.emplace_back(position);
		}

		for (auto &&normal : loadedBuffer.normals) {
			normals.emplace_back(normal);
		}

		for (auto &&textCoord : loadedBuffer.textCoords) {
			textCoords.emplace_back(textCoord);
		}

		for (size_t i = 0; i < loadedBuffer.positions.size(); i++) {
			references.emplace_back(Reference{ 0, 1 });
		}

		transforms.emplace_back(TransformComponent{ glm::vec3(0.0f), glm::vec3(50.0f), glm::vec3(glm::radians(0.0f), glm::radians(0.0f), glm::radians(0.0f)) }); */

		// ----------------------------------------------------------------------------
		
		materials.emplace_back(Material{ glm::vec4{ 1.0f, 1.0f, 1.0f, 1.0f }, glm::vec4{ 0.0f, 0.0f, 0.0f, 0.0f }, 0u });
		materials.emplace_back(Material{ glm::vec4{ 1.0f, 1.0f, 1.0f, 1.0f }, glm::vec4{ 0.0f, 0.0f, 0.0f, 0.0f }, 1u });

		spotLights.resize(1);
		spotLights[0].position = glm::vec4{ 0.0f, 50.0f, 0.0f, 1.0f };
		spotLights[0].color = glm::vec4{ 10000.0f, 10000.0f, 10000.0f, 1.0f };
		spotLights[0].direction = glm::vec4(0.0f, 0.0f, 0.0f, 0.0f) - spotLights[0].position;
		spotLights[0].angle = 60;

		this->spotNumLight = static_cast<uint32_t>(spotLights.size());

		// ----------------------------------------------------------------------------

		auto commandBuffer = this->renderer->beginRecordTransferCommand();

		this->indexBuffer = new ArrayBuffer<uint32_t>(this->device, VK_BUFFER_USAGE_INDEX_BUFFER_BIT);
		this->indexBuffer->replace(commandBuffer, indices);

		this->positionBuffer = new ArrayBuffer<Position>(this->device, VK_BUFFER_USAGE_VERTEX_BUFFER_BIT);
		this->positionBuffer->replace(commandBuffer, positions);

		this->normalBuffer = new ArrayBuffer<Normal>(this->device, VK_BUFFER_USAGE_VERTEX_BUFFER_BIT);
		this->normalBuffer->replace(commandBuffer, normals);

		this->textCoordBuffer = new ArrayBuffer<TextCoord>(this->device, VK_BUFFER_USAGE_VERTEX_BUFFER_BIT);
		this->textCoordBuffer->replace(commandBuffer, textCoords);

		this->referenceBuffer = new ArrayBuffer<Reference>(this->device, VK_BUFFER_USAGE_VERTEX_BUFFER_BIT);
		this->referenceBuffer->replace(commandBuffer, references);

		this->materialBuffer = new ArrayBuffer<Material>(this->device, VK_BUFFER_USAGE_STORAGE_BUFFER_BIT);
		this->materialBuffer->replace(commandBuffer, materials);

		this->transformationBuffer = new ArrayBuffer<Transformation>(this->device, VK_BUFFER_USAGE_STORAGE_BUFFER_BIT);
		this->transformationBuffer->replace(commandBuffer, ConvertComponentToTransform(transforms));

		this->spotLightBuffer = new ArrayBuffer<SpotLight>(this->device, VK_BUFFER_USAGE_STORAGE_BUFFER_BIT);
		this->spotLightBuffer->replace(commandBuffer, spotLights);

		this->colorTextures.resize(1);
		this->colorTextures[0] = new Texture(this->device, commandBuffer, "../assets/textures/viking_room.png");

		commandBuffer->endCommand();
		this->renderer->submitTransferCommand();
	}

	void App::initCamera(uint32_t width, uint32_t height) {
		glm::vec3 position = glm::vec3(0.0f, 30.0f, -30.0f);
		glm::vec3 target = glm::vec3(0.0f, 0.0f, 0.0f);
		glm::vec3 vup = glm::vec3(0.0f, 0.0f, 1.0f);

		float near = 0.1f;
		float far = 2000.0f;

		float theta = glm::radians(45.0f);
		float aspectRatio = static_cast<float>(width) / static_cast<float>(height);

		this->camera->setPerspectiveProjection(theta, aspectRatio, near, far);
		this->camera->setViewTarget(position, target, vup);

		glm::mat4 view = this->camera->getViewMatrix();
		glm::mat4 projection = this->camera->getProjectionMatrix();

		this->forwardUbo.cameraTransforms = projection * view;
	}

	void App::init() {
		uint32_t width = this->renderer->getSwapChain()->getWidth();
		uint32_t height = this->renderer->getSwapChain()->getHeight();
		uint32_t imageCount = static_cast<uint32_t>(this->renderer->getSwapChain()->getImageCount());
		VkSampleCountFlagBits msaaSample = this->device->getMSAASamples();

		this->initCamera(width, height);
		this->forwardUniform = new ObjectBuffer<ForwardUbo>(this->device, VK_BUFFER_USAGE_UNIFORM_BUFFER_BIT);

		std::vector<VkDescriptorImageInfo> rayTraceImageInfos;

		this->rayTraceImages.resize(NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT);
		rayTraceImageInfos.resize(NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT);

		for (uint32_t i = 0; i < NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT; i++) {
			this->rayTraceImages[i] = new NugieVulkan::Image(this->device, width, height, 1, VK_SAMPLE_COUNT_1_BIT, this->renderer->getSwapChain()->getSwapChainImageFormat(),
        VK_IMAGE_TILING_OPTIMAL, VK_IMAGE_USAGE_STORAGE_BIT | VK_IMAGE_USAGE_TRANSFER_SRC_BIT, VMA_MEMORY_USAGE_AUTO, VMA_ALLOCATION_CREATE_DEDICATED_MEMORY_BIT, 
        VK_IMAGE_ASPECT_COLOR_BIT);

			rayTraceImageInfos[i] = this->rayTraceImages[i]->getDescriptorInfo(VK_IMAGE_LAYOUT_GENERAL);
		}

		this->forwardSubRenderer = SubRenderer::Builder(this->device, width, height, imageCount)
			.addAttachment(AttachmentType::KEEPED, VK_FORMAT_R32G32B32A32_SFLOAT, 
				VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL, msaaSample)
			.addAttachment(AttachmentType::KEEPED, VK_FORMAT_R32G32B32A32_SFLOAT, 
				VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL, msaaSample)
			.addAttachment(AttachmentType::KEEPED, VK_FORMAT_R16G16_UNORM, 
				VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL, msaaSample)
			.addAttachment(AttachmentType::KEEPED, VK_FORMAT_R8_UINT,
				VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL, msaaSample)
			.setDepthAttachment(AttachmentType::KEEPED, VK_FORMAT_D16_UNORM, 
				VK_IMAGE_LAYOUT_DEPTH_STENCIL_ATTACHMENT_OPTIMAL, msaaSample)
			.addResolvedAttachment(AttachmentType::OUTPUT_SHADER, VK_FORMAT_R32G32B32A32_SFLOAT,
				VK_IMAGE_LAYOUT_GENERAL)
			.addResolvedAttachment(AttachmentType::OUTPUT_SHADER, VK_FORMAT_R32G32B32A32_SFLOAT,
				VK_IMAGE_LAYOUT_GENERAL)
			.addResolvedAttachment(AttachmentType::OUTPUT_SHADER, VK_FORMAT_R16G16_UNORM,
				VK_IMAGE_LAYOUT_GENERAL)
			.addResolvedAttachment(AttachmentType::OUTPUT_SHADER, VK_FORMAT_R8_UINT,
				VK_IMAGE_LAYOUT_GENERAL)
			.build();

		this->forwardDescSet = DescriptorSet::Builder(this->device, this->renderer->getDescriptorPool(), NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT)
			.addBuffer(0, VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, VK_SHADER_STAGE_VERTEX_BIT, this->forwardUniform->getInfo())
			.addBuffer(1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_VERTEX_BIT, this->transformationBuffer->getInfo())
			.build();

		this->rayTraceDescSet = DescriptorSet::Builder(this->device, this->renderer->getDescriptorPool(), NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT)
			.addImage(0, VK_DESCRIPTOR_TYPE_STORAGE_IMAGE, VK_SHADER_STAGE_COMPUTE_BIT, this->forwardSubRenderer->getAttachmentInfos(0)[0])
			.addImage(1, VK_DESCRIPTOR_TYPE_STORAGE_IMAGE, VK_SHADER_STAGE_COMPUTE_BIT, this->forwardSubRenderer->getAttachmentInfos(0)[1])
			.addImage(2, VK_DESCRIPTOR_TYPE_STORAGE_IMAGE, VK_SHADER_STAGE_COMPUTE_BIT, this->forwardSubRenderer->getAttachmentInfos(0)[2])
			.addImage(3, VK_DESCRIPTOR_TYPE_STORAGE_IMAGE, VK_SHADER_STAGE_COMPUTE_BIT, this->forwardSubRenderer->getAttachmentInfos(0)[3])
			.addImage(4, VK_DESCRIPTOR_TYPE_STORAGE_IMAGE, VK_SHADER_STAGE_COMPUTE_BIT, rayTraceImageInfos)
			.addBuffer(5, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->materialBuffer->getInfo())
			.addImage(6, VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER, VK_SHADER_STAGE_COMPUTE_BIT, this->colorTextures[0]->getDescriptorInfo(VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL))
			.build();

		this->forwardPassRenderer = new ForwardPassRenderSystem(this->device, { this->forwardDescSet->getDescSetLayout() }, this->forwardSubRenderer->getRenderPass(), "shader/forward.vert.spv", "shader/forward.frag.spv");
		this->rayTraceRenderer = new ComputeRenderSystem(this->device, { this->rayTraceDescSet->getDescSetLayout() }, "shader/ray_trace.comp.spv");

		this->forwardPassRenderer->initialize();
		this->rayTraceRenderer->initialize();
	}

	void App::resize() {
		uint32_t width = this->renderer->getSwapChain()->getWidth();
		uint32_t height = this->renderer->getSwapChain()->getHeight();
		uint32_t imageCount = static_cast<uint32_t>(this->renderer->getSwapChain()->getImageCount());

		this->renderer->resetCommandPool();

		std::vector<VkDescriptorImageInfo> rayTraceImageInfos;
		rayTraceImageInfos.resize(NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT);

		for (uint32_t i = 0; i < NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT; i++) {
			if (this->rayTraceImages[i] != nullptr) delete this->rayTraceImages[i];

			this->rayTraceImages[i] = new NugieVulkan::Image(this->device, width, height, 1, VK_SAMPLE_COUNT_1_BIT, this->renderer->getSwapChain()->getSwapChainImageFormat(),
        VK_IMAGE_TILING_OPTIMAL, VK_IMAGE_USAGE_STORAGE_BIT | VK_IMAGE_USAGE_TRANSFER_SRC_BIT, VMA_MEMORY_USAGE_AUTO, VMA_ALLOCATION_CREATE_DEDICATED_MEMORY_BIT, 
        VK_IMAGE_ASPECT_COLOR_BIT);

			rayTraceImageInfos[i] = this->rayTraceImages[i]->getDescriptorInfo(VK_IMAGE_LAYOUT_GENERAL);
		}

		SubRenderer::Overwriter(this->device, width, height, imageCount)
			.addOutsideAttachment(this->renderer->getSwapChain()->getswapChainImages())
			.overwrite(this->forwardSubRenderer);

		DescriptorSet::Overwriter(imageCount)
			.addImage(0, this->forwardSubRenderer->getAttachmentInfos(0)[0])
			.addImage(1, this->forwardSubRenderer->getAttachmentInfos(0)[1])
			.addImage(2, this->forwardSubRenderer->getAttachmentInfos(0)[2])
			.addImage(3, this->forwardSubRenderer->getAttachmentInfos(0)[3])
			.addImage(4, rayTraceImageInfos)
			.overwrite(this->rayTraceDescSet);

		float aspectRatio = static_cast<float>(width) / static_cast<float>(height);
		this->camera->setAspect(aspectRatio);

		this->forwardUbo.cameraTransforms = this->camera->getProjectionMatrix() * this->camera->getViewMatrix();
		this->cameraUpdateCount = 0u;
		
		this->recordCommand();
	}
}