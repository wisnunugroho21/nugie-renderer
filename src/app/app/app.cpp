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
		if (this->rayGenPassRenderer != nullptr) delete this->rayGenPassRenderer;
		if (this->finalPasRenderer != nullptr) delete this->finalPasRenderer;

		if (this->forwardSubRenderer != nullptr) delete this->forwardSubRenderer;
		if (this->finalSubRenderer != nullptr) delete this->finalSubRenderer;
		
		if (this->renderer != nullptr) delete this->renderer;

		if (this->forwardDescSet != nullptr) delete this->forwardDescSet;
		if (this->rayGenDescSet != nullptr) delete this->rayGenDescSet;
		if (this->finalDescSet != nullptr) delete this->finalDescSet;

		if (this->forwardUniform != nullptr) delete this->forwardUniform;
		if (this->rayGenImage != nullptr) delete this->rayGenImage;

		if (this->indexModel != nullptr) delete this->indexModel;
		if (this->positionModel != nullptr) delete this->positionModel;
		if (this->normalModel != nullptr) delete this->normalModel;
		if (this->textCoordModel != nullptr) delete this->textCoordModel;
		if (this->referenceModel != nullptr) delete this->referenceModel;
		if (this->materialModel != nullptr) delete this->materialModel;
		if (this->transformationModel != nullptr) delete this->transformationModel;
		
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
		uint32_t imageCount = static_cast<uint32_t>(this->renderer->getSwapChain()->getImageCount());

		auto prepareCommandBuffer = this->renderer->beginRecordPrepareCommand();
		for (auto &&colorTexture : this->colorTextures) {
			if (!colorTexture->hasBeenMipmapped()) {
				colorTexture->generateMipmap(prepareCommandBuffer);
			}
		}

		for (uint32_t frameIndex = 0; frameIndex < NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT; frameIndex++) {
			this->rayGenImage->prepareBarrier(prepareCommandBuffer, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, frameIndex);
		}

		prepareCommandBuffer->endCommand();

		std::vector<NugieVulkan::Buffer*> forwardBuffers;
		forwardBuffers.emplace_back(this->positionModel->getBuffer());
		forwardBuffers.emplace_back(this->normalModel->getBuffer());
		forwardBuffers.emplace_back(this->textCoordModel->getBuffer());
		forwardBuffers.emplace_back(this->referenceModel->getBuffer());

		std::vector<NugieVulkan::Buffer*> shadowBuffers;
		shadowBuffers.emplace_back(this->positionModel->getBuffer());
		shadowBuffers.emplace_back(this->referenceModel->getBuffer());

		for (uint32_t imageIndex = 0; imageIndex < imageCount; imageIndex++) {
			for (uint32_t frameIndex = 0; frameIndex < NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT; frameIndex++) {
				auto commandBuffer = this->renderer->beginRecordRenderCommand(frameIndex, imageIndex);

				// this->forwardSubRenderer->beginRenderPass(commandBuffer, frameIndex);
				// this->forwardPassRenderer->render(commandBuffer, { this->forwardDescSet->getDescriptorSets(frameIndex) }, forwardBuffers, this->indexModel->getBuffer(), this->indexModel->size());
				// this->forwardSubRenderer->endRenderPass(commandBuffer);

				// this->rayGenPassRenderer->render(commandBuffer, { this->rayGenDescSet->getDescriptorSets(frameIndex) }, width / 32, height / 32, 1);

				this->rayGenImage->writeToReadBarrier(commandBuffer, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_FRAGMENT_SHADER_BIT, frameIndex);

				this->finalSubRenderer->beginRenderPass(commandBuffer, imageIndex);
				this->finalPasRenderer->render(commandBuffer, { this->finalDescSet->getDescriptorSets(frameIndex) });
				this->finalSubRenderer->endRenderPass(commandBuffer);

				this->rayGenImage->readToWriteBarrier(commandBuffer, VK_PIPELINE_STAGE_FRAGMENT_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, frameIndex);

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
		forwardBuffers.emplace_back(this->positionModel->getBuffer());
		forwardBuffers.emplace_back(this->normalModel->getBuffer());
		forwardBuffers.emplace_back(this->textCoordModel->getBuffer());
		forwardBuffers.emplace_back(this->referenceModel->getBuffer());

		std::vector<NugieVulkan::Buffer*> shadowBuffers;
		shadowBuffers.emplace_back(this->positionModel->getBuffer());
		shadowBuffers.emplace_back(this->referenceModel->getBuffer());

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

		LoadedModel loadedModel = loadObjModel("../assets/models/viking_room.obj");

		auto positionSize = static_cast<uint32_t>(positions.size());
		for (auto &&index : loadedModel.indices) {
			indices.emplace_back(positionSize + index);
		}

		for (auto &&position : loadedModel.positions) {
			positions.emplace_back(position);
		}

		for (auto &&normal : loadedModel.normals) {
			normals.emplace_back(normal);
		}

		for (auto &&textCoord : loadedModel.textCoords) {
			textCoords.emplace_back(textCoord);
		}

		for (size_t i = 0; i < loadedModel.positions.size(); i++) {
			references.emplace_back(Reference{ 1, 0 });
		}

		transforms.emplace_back(TransformComponent{ glm::vec3(0.0f, 0.0f, 0.0f), glm::vec3(10.0f), glm::vec3(glm::radians(270.0f), glm::radians(90.0f), glm::radians(0.0f)) });

		// ----------------------------------------------------------------------------

		/* loadedModel = loadObjModel("../assets/models/quad_model.obj");

		positionSize = static_cast<uint32_t>(positions.size());
		for (auto &&index : loadedModel.indices) {
			indices.emplace_back(positionSize + index);
		}

		for (auto &&position : loadedModel.positions) {
			positions.emplace_back(position);
		}

		for (auto &&normal : loadedModel.normals) {
			normals.emplace_back(normal);
		}

		for (auto &&textCoord : loadedModel.textCoords) {
			textCoords.emplace_back(textCoord);
		}

		for (size_t i = 0; i < loadedModel.positions.size(); i++) {
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

		this->indexModel = new IndexBufferObject<uint32_t>(this->device);
		this->indexModel->replace(commandBuffer, indices);

		this->positionModel = new VertexBufferObject<Position>(this->device);
		this->positionModel->replace(commandBuffer, positions);

		this->normalModel = new VertexBufferObject<Normal>(this->device);
		this->normalModel->replace(commandBuffer, normals);

		this->textCoordModel = new VertexBufferObject<TextCoord>(this->device);
		this->textCoordModel->replace(commandBuffer, textCoords);

		this->referenceModel = new VertexBufferObject<Reference>(this->device);
		this->referenceModel->replace(commandBuffer, references);

		this->materialModel = new ShaderStorageBufferObject<Material>(this->device);
		this->materialModel->replace(commandBuffer, materials);

		this->transformationModel = new ShaderStorageBufferObject<Transformation>(this->device);
		this->transformationModel->replace(commandBuffer, ConvertComponentToTransform(transforms));

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

		this->forwardUniform = new UniformBufferObject<ForwardUbo>(this->device);
		this->rayGenImage = new UniformImageBuffer(this->device, width, height, NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT, 
			VK_FORMAT_R32G32B32A32_SFLOAT, VK_SAMPLE_COUNT_1_BIT);

		this->forwardSubRenderer = SubRenderer::Builder(this->device, width, height, NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT)
			.addAttachment(AttachmentType::OUTPUT_TEXTURE, VK_FORMAT_R32G32B32A32_SFLOAT, 
				VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL, VK_SAMPLE_COUNT_1_BIT)
			.addAttachment(AttachmentType::OUTPUT_TEXTURE, VK_FORMAT_R32G32B32A32_SFLOAT, 
				VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL, VK_SAMPLE_COUNT_1_BIT)
			.addAttachment(AttachmentType::OUTPUT_TEXTURE, VK_FORMAT_R16G16_UNORM, 
				VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL, VK_SAMPLE_COUNT_1_BIT)
			.addAttachment(AttachmentType::OUTPUT_TEXTURE, VK_FORMAT_R8_UINT,
				VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL, VK_SAMPLE_COUNT_1_BIT)
			.setDepthAttachment(AttachmentType::KEEPED, VK_FORMAT_D16_UNORM, 
				VK_IMAGE_LAYOUT_DEPTH_STENCIL_ATTACHMENT_OPTIMAL, VK_SAMPLE_COUNT_1_BIT)
			.build();

		this->finalSubRenderer = SubRenderer::Builder(this->device, width, height, imageCount)
			.addAttachment(this->renderer->getSwapChain()->getswapChainImages(), AttachmentType::KEEPED, 
				this->renderer->getSwapChain()->getSwapChainImageFormat(), 
				VK_IMAGE_LAYOUT_PRESENT_SRC_KHR, VK_SAMPLE_COUNT_1_BIT)
			.setDepthAttachment(AttachmentType::KEEPED, VK_FORMAT_D16_UNORM, 
				VK_IMAGE_LAYOUT_DEPTH_STENCIL_ATTACHMENT_OPTIMAL, VK_SAMPLE_COUNT_1_BIT)
			.build();

		this->forwardDescSet = DescriptorSet::Builder(this->device, this->renderer->getDescriptorPool(), NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT)
			.addBuffer(0, VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, VK_SHADER_STAGE_VERTEX_BIT, this->forwardUniform->getInfo())
			.addBuffer(1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_VERTEX_BIT, this->transformationModel->getInfo())
			.build();

		this->rayGenDescSet = DescriptorSet::Builder(this->device, this->renderer->getDescriptorPool(), NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT)
			.addImage(0, VK_DESCRIPTOR_TYPE_STORAGE_IMAGE, VK_SHADER_STAGE_COMPUTE_BIT, this->rayGenImage->getImagesInfo())
			.addImage(1, VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER, VK_SHADER_STAGE_COMPUTE_BIT, this->forwardSubRenderer->getAttachmentInfos(0)[0])
			.addImage(2, VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER, VK_SHADER_STAGE_COMPUTE_BIT, this->forwardSubRenderer->getAttachmentInfos(0)[1])
			.addImage(3, VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER, VK_SHADER_STAGE_COMPUTE_BIT, this->forwardSubRenderer->getAttachmentInfos(0)[2])
			.addImage(4, VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER, VK_SHADER_STAGE_COMPUTE_BIT, this->forwardSubRenderer->getAttachmentInfos(0)[3])
			.build();

		this->finalDescSet = DescriptorSet::Builder(this->device, this->renderer->getDescriptorPool(), NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT)
			.addImage(0, VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER, VK_SHADER_STAGE_FRAGMENT_BIT, this->rayGenImage->getSampleInfo())
			.build();

		this->forwardPassRenderer = new ForwardPassRenderSystem(this->device, { this->forwardDescSet->getDescSetLayout() }, this->forwardSubRenderer->getRenderPass(), "shader/forward.vert.spv", "shader/forward.frag.spv");
		this->rayGenPassRenderer = new ComputeRenderSystem(this->device, { this->rayGenDescSet->getDescSetLayout() }, "shader/raygen.comp.spv");
		this->finalPasRenderer = new QuadGraphicRenderSystem(this->device, { this->finalDescSet->getDescSetLayout() }, this->finalSubRenderer->getRenderPass(), "shader/final.frag.spv");

		this->forwardPassRenderer->initialize();
		this->rayGenPassRenderer->initialize();
		this->finalPasRenderer->initialize();
	}

	void App::resize() {
		uint32_t width = this->renderer->getSwapChain()->getWidth();
		uint32_t height = this->renderer->getSwapChain()->getHeight();
		uint32_t imageCount = static_cast<uint32_t>(this->renderer->getSwapChain()->getImageCount());
		VkSampleCountFlagBits msaaSample = this->device->getMSAASamples();

		this->renderer->resetCommandPool();

		SubRenderer::Overwriter(this->device, width, height, NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT)
			.overwrite(this->forwardSubRenderer);

		this->rayGenImage->resize(width, height);

		SubRenderer::Overwriter(this->device, width, height, imageCount)
			.addOutsideAttachment(this->renderer->getSwapChain()->getswapChainImages())
			.overwrite(this->finalSubRenderer);

		DescriptorSet::Overwriter(NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT)
			.addImage(0, this->rayGenImage->getImagesInfo())
			.addImage(1, this->forwardSubRenderer->getAttachmentInfos(0)[0])
			.addImage(2, this->forwardSubRenderer->getAttachmentInfos(0)[1])
			.addImage(3, this->forwardSubRenderer->getAttachmentInfos(0)[2])
			.addImage(4, this->forwardSubRenderer->getAttachmentInfos(0)[3])
			.overwrite(this->rayGenDescSet);

		DescriptorSet::Overwriter(NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT)
			.addImage(0, this->rayGenImage->getSampleInfo())
			.overwrite(this->finalDescSet);

		float aspectRatio = static_cast<float>(width) / static_cast<float>(height);
		this->camera->setAspect(aspectRatio);

		this->forwardUbo.cameraTransforms = this->camera->getProjectionMatrix() * this->camera->getViewMatrix();
		this->cameraUpdateCount = 0u;
		
		this->recordCommand();
	}
}