#include "app.hpp"

#include "../renderer_sub/shadow_sub_renderer.hpp"
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
		if (this->deferredPasRenderer != nullptr) delete this->deferredPasRenderer;
		if (this->spotShadowPassRenderer != nullptr) delete this->spotShadowPassRenderer;

		if (this->forwardSubPartRenderer != nullptr) delete this->forwardSubPartRenderer;
		if (this->deferredSubPartRenderer != nullptr) delete this->deferredSubPartRenderer;
		if (this->spotShadowSubPartRenderer != nullptr) delete this->spotShadowSubPartRenderer;

		if (this->finalSubRenderer != nullptr) delete this->finalSubRenderer;
		if (this->spotShadowSubRenderer != nullptr) delete this->spotShadowSubRenderer;
		if (this->renderer != nullptr) delete this->renderer;

		if (this->spotShadowDescSet != nullptr) delete this->spotShadowDescSet;
		if (this->forwardDescSet != nullptr) delete this->forwardDescSet;
		if (this->attachmentDeferredDescSet != nullptr) delete this->attachmentDeferredDescSet;
		if (this->modelDeferredDescSet != nullptr) delete this->modelDeferredDescSet;

		if (this->forwardUniform != nullptr) delete this->forwardUniform;
		if (this->deferredUniform != nullptr) delete this->deferredUniform;

		if (this->indexModel != nullptr) delete this->indexModel;
		if (this->positionModel != nullptr) delete this->positionModel;
		if (this->normalModel != nullptr) delete this->normalModel;
		if (this->textCoordModel != nullptr) delete this->textCoordModel;
		if (this->referenceModel != nullptr) delete this->referenceModel;
		if (this->materialModel != nullptr) delete this->materialModel;
		if (this->transformationModel != nullptr) delete this->transformationModel;
		if (this->shadowTransformationModel != nullptr) delete this->shadowTransformationModel;
		if (this->spotLightModel != nullptr) delete this->spotLightModel;
		
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
		auto prepareCommandBuffer = this->renderer->beginRecordPrepareCommand();
		for (auto &&colorTexture : this->colorTextures) {
			if (!colorTexture->hasBeenMipmapped()) {
				colorTexture->generateMipmap(prepareCommandBuffer);
			}
		}

		prepareCommandBuffer->endCommand();

		uint32_t imageCount = static_cast<uint32_t>(this->renderer->getSwapChain()->getImageCount());

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
				std::vector<VkDescriptorSet> descriptorSets;
				descriptorSets.emplace_back(this->attachmentDeferredDescSet->getDescriptorSets(imageIndex));
				descriptorSets.emplace_back(this->modelDeferredDescSet->getDescriptorSets(frameIndex));

				auto commandBuffer = this->renderer->beginRecordRenderCommand(frameIndex, imageIndex);

				uint32_t lightIndex = frameIndex * this->spotNumLight;
				for (uint32_t i = 0; i < this->spotNumLight; i++) {
					this->spotShadowSubRenderer->beginRenderPass(commandBuffer, lightIndex + i);
					this->spotShadowPassRenderer->render(commandBuffer, i, this->spotShadowDescSet->getDescriptorSets(frameIndex), shadowBuffers, this->indexModel->getBuffer(), this->indexModel->size());
					this->spotShadowSubRenderer->endRenderPass(commandBuffer);
				}

				this->finalSubRenderer->beginRenderPass(commandBuffer, imageIndex);

				this->forwardPassRenderer->render(commandBuffer, this->forwardDescSet->getDescriptorSets(frameIndex), forwardBuffers, this->indexModel->getBuffer(), this->indexModel->size());
				this->finalSubRenderer->nextSubpass(commandBuffer, VK_SUBPASS_CONTENTS_INLINE);
				this->deferredPasRenderer->render(commandBuffer, descriptorSets);

				this->finalSubRenderer->endRenderPass(commandBuffer);

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
			this->deferredUniform->writeGlobalData(i, this->deferredUbo);
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
			this->deferredUniform->writeGlobalData(i, this->deferredUbo);
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

		transforms.emplace_back(TransformComponent{ glm::vec3(0.0f, 10.0f, 0.0f), glm::vec3(10.0f), glm::vec3(glm::radians(270.0f), glm::radians(90.0f), glm::radians(0.0f)) });

		// ----------------------------------------------------------------------------

		loadedModel = loadObjModel("../assets/models/quad_model.obj");

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

		transforms.emplace_back(TransformComponent{ glm::vec3(0.0f), glm::vec3(50.0f), glm::vec3(glm::radians(0.0f), glm::radians(0.0f), glm::radians(0.0f)) });

		// ----------------------------------------------------------------------------
		
		materials.emplace_back(Material{ glm::vec4{ 1.0f, 1.0f, 1.0f, 1.0f }, glm::vec4{ 0.0f, 0.0f, 0.0f, 0.0f }, 0u });
		materials.emplace_back(Material{ glm::vec4{ 1.0f, 1.0f, 1.0f, 1.0f }, glm::vec4{ 0.0f, 0.0f, 0.0f, 0.0f }, 1u });

		spotLights.resize(1);
		spotLights[0].position = glm::vec4{ -50.0f, 50.0f, -50.0f, 1.0f };
		spotLights[0].color = glm::vec4{ 100000.0f, 100000.0f, 100000.0f, 1.0f };
		spotLights[0].direction = glm::vec4(0.0f, 0.0f, 0.0f, 0.0f) - spotLights[0].position;
		spotLights[0].angle = 60;

		this->spotNumLight = static_cast<uint32_t>(spotLights.size());

		// ---------------------------------------------------------------------

		uint32_t width = this->renderer->getSwapChain()->getWidth();
		uint32_t height = this->renderer->getSwapChain()->getHeight();

		Camera shadowCamera;
		float near = 0.1f;
		float far = 2000.0f;
		float aspectRatio = static_cast<float>(width) / static_cast<float>(height);
		float theta = glm::radians(90.0f);

		shadowCamera.setPerspectiveProjection(theta, aspectRatio, near, far);
		glm::mat4 projection = shadowCamera.getProjectionMatrix();

		shadowTransforms.resize(this->spotNumLight);
		
		for (uint32_t i = 0; i < this->spotNumLight; i++) {
			glm::vec3 upVector = glm::vec3(0.0f, -1.0f, 0.0f);
			shadowCamera.setViewDirection(spotLights[i].position, spotLights[i].direction, upVector);
			shadowTransforms[i].viewProjectionMatrix = projection * shadowCamera.getViewMatrix();
		}

		this->deferredUbo.numLights = glm::uvec4(this->spotNumLight, 0u, 0u, 0u);

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

		this->spotLightModel = new ShaderStorageBufferObject<SpotLight>(this->device);
		this->spotLightModel->replace(commandBuffer, spotLights);

		this->shadowTransformationModel = new ShaderStorageBufferObject<ShadowTransformation>(this->device);
		this->shadowTransformationModel->replace(commandBuffer, shadowTransforms);

		this->colorTextures.resize(1);
		this->colorTextures[0] = new NugieApp::Texture(this->device, commandBuffer, "../assets/textures/viking_room.png");

		commandBuffer->endCommand();
		this->renderer->submitTransferCommand();
	}

	void App::initCamera(uint32_t width, uint32_t height) {
		glm::vec3 position = glm::vec3(0.0f, 30.0f, -60.0f);
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
		this->deferredUbo.origin = glm::vec4(position, 1.0f);
	}

	void App::init() {
		uint32_t width = this->renderer->getSwapChain()->getWidth();
		uint32_t height = this->renderer->getSwapChain()->getHeight();
		uint32_t imageCount = static_cast<uint32_t>(this->renderer->getSwapChain()->getImageCount());

		this->initCamera(width, height);

		this->forwardSubPartRenderer = new ForwardSubPartRenderer(this->device, imageCount, width, height);
		this->deferredSubPartRenderer = new DeferredSubPartRenderer(this->device, this->renderer->getSwapChain()->getswapChainImages(), 
			this->renderer->getSwapChain()->getSwapChainImageFormat(), imageCount, width, height);
		this->spotShadowSubPartRenderer = new SpotShadowSubPartRenderer(this->device, SHADOW_RESOLUTION, SHADOW_RESOLUTION, this->spotNumLight);

		this->finalSubRenderer = SubRenderer::Builder(this->device, width, height)
			.addSubPass(this->forwardSubPartRenderer->getAttachments(), this->forwardSubPartRenderer->getAttachmentDescs(),
				this->forwardSubPartRenderer->getOutputAttachmentRefs(), this->forwardSubPartRenderer->getDepthAttachmentRef())
			.addSubPass(this->deferredSubPartRenderer->getAttachments(), this->deferredSubPartRenderer->getAttachmentDescs(),
				this->deferredSubPartRenderer->getOutputAttachmentRefs(), this->deferredSubPartRenderer->getDepthAttachmentRef(),
				this->deferredSubPartRenderer->getInputAttachmentRefs())
			.addResolveAttachmentRef(this->deferredSubPartRenderer->getResolveAttachmentRef())
			.build();

		this->spotShadowSubRenderer = ShadowSubRenderer::Builder(this->device, SHADOW_RESOLUTION, SHADOW_RESOLUTION, 1u)
			.addSubPass(this->spotShadowSubPartRenderer->getAttachments(), this->spotShadowSubPartRenderer->getAttachmentDescs(),
				{}, this->spotShadowSubPartRenderer->getDepthAttachmentRef())
			.build();
		
		this->forwardUniform = new UniformBufferObject<ForwardUbo>(this->device);
		this->deferredUniform = new UniformBufferObject<DeferredUbo>(this->device);

		this->spotShadowDescSet = NugieApp::DescriptorSet::Builder(this->device, this->renderer->getDescriptorPool(), NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT)
			.addBuffer(0, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_VERTEX_BIT, this->transformationModel->getInfo())
			.addBuffer(1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_VERTEX_BIT, this->shadowTransformationModel->getInfo())
			.build();

		this->forwardDescSet = NugieApp::DescriptorSet::Builder(this->device, this->renderer->getDescriptorPool(), NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT)
			.addBuffer(0, VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, VK_SHADER_STAGE_VERTEX_BIT, this->forwardUniform->getInfo())
			.addBuffer(1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_VERTEX_BIT, this->transformationModel->getInfo())
			.build();

		this->attachmentDeferredDescSet = NugieApp::DescriptorSet::Builder(this->device, this->renderer->getDescriptorPool(), imageCount)
			.addImage(0, VK_DESCRIPTOR_TYPE_INPUT_ATTACHMENT, VK_SHADER_STAGE_FRAGMENT_BIT, this->forwardSubPartRenderer->getPositionInfoResources())
			.addImage(1, VK_DESCRIPTOR_TYPE_INPUT_ATTACHMENT, VK_SHADER_STAGE_FRAGMENT_BIT, this->forwardSubPartRenderer->getNormalInfoResources())
			.addImage(2, VK_DESCRIPTOR_TYPE_INPUT_ATTACHMENT, VK_SHADER_STAGE_FRAGMENT_BIT, this->forwardSubPartRenderer->getTextCoordInfoResources())
			.addImage(3, VK_DESCRIPTOR_TYPE_INPUT_ATTACHMENT, VK_SHADER_STAGE_FRAGMENT_BIT, this->forwardSubPartRenderer->getMaterialIndexInfoResources())
			.build();

		this->modelDeferredDescSet = NugieApp::DescriptorSet::Builder(this->device, this->renderer->getDescriptorPool(), NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT)
			.addBuffer(0, VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, VK_SHADER_STAGE_FRAGMENT_BIT, this->deferredUniform->getInfo())
			.addBuffer(1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_FRAGMENT_BIT, this->materialModel->getInfo())
			.addBuffer(2, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_FRAGMENT_BIT, this->shadowTransformationModel->getInfo())
			.addBuffer(3, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_FRAGMENT_BIT, this->spotLightModel->getInfo())
			.addImage(4, VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER, VK_SHADER_STAGE_FRAGMENT_BIT, this->spotShadowSubPartRenderer->getDepthInfoResources())
			.addImage(5, VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER, VK_SHADER_STAGE_FRAGMENT_BIT, this->colorTextures[0]->getDescriptorInfo())
			.build();

		this->spotShadowPassRenderer = new SpotShadowPassRenderSystem(this->device, this->spotShadowDescSet->getDescSetLayout(), this->spotShadowSubRenderer->getRenderPass());
		this->forwardPassRenderer = new ForwardPassRenderSystem(this->device, this->forwardDescSet->getDescSetLayout(), this->finalSubRenderer->getRenderPass());
		this->deferredPasRenderer = new DeferredPassRenderSystem(this->device, { this->attachmentDeferredDescSet->getDescSetLayout(), this->modelDeferredDescSet->getDescSetLayout() }, this->finalSubRenderer->getRenderPass());
	}

	void App::resize() {
		uint32_t width = this->renderer->getSwapChain()->getWidth();
		uint32_t height = this->renderer->getSwapChain()->getHeight();

		this->forwardSubPartRenderer->recreateResources(width, height);
		this->deferredSubPartRenderer->recreateResources(this->renderer->getSwapChain()->getswapChainImages(), width, height);
		this->spotShadowSubPartRenderer->recreateResources(width, height);

		std::vector<std::vector<VkImageView>> finalSubImageViews;
		std::vector<std::vector<VkImageView>> pointSubImageViews;
		std::vector<std::vector<VkImageView>> spotSubImageViews;

		auto forwardAttachments = this->forwardSubPartRenderer->getAttachments();
		auto deferredAttachments = this->deferredSubPartRenderer->getAttachments();
		auto spotAttachments = this->spotShadowSubPartRenderer->getAttachments();

		for (size_t i = 0; i < forwardAttachments[0].size(); i++) {
			std::vector<VkImageView> imageViews;

			for (size_t j = 0; j < forwardAttachments.size(); j++) {
				imageViews.emplace_back(forwardAttachments[j][i]);
			}

			for (size_t j = 0; j < deferredAttachments.size(); j++) {
				imageViews.emplace_back(deferredAttachments[j][i]);
			}

			finalSubImageViews.emplace_back(imageViews);
		}

		for (size_t i = 0; i < spotAttachments[0].size(); i++) {
			std::vector<VkImageView> imageViews;

			for (size_t j = 0; j < spotAttachments.size(); j++) {
				imageViews.emplace_back(spotAttachments[j][i]);
			}

			spotSubImageViews.emplace_back(imageViews);
		}

		this->finalSubRenderer->recreateResources(finalSubImageViews, width, height);
		this->spotShadowSubRenderer->recreateResources(spotSubImageViews, width, height);

		NugieApp::DescriptorSet::Overwriter(NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT)
			.addImage(0, this->forwardSubPartRenderer->getPositionInfoResources())
			.addImage(1, this->forwardSubPartRenderer->getNormalInfoResources())
			.addImage(2, this->forwardSubPartRenderer->getTextCoordInfoResources())
			.addImage(3, this->forwardSubPartRenderer->getMaterialIndexInfoResources())
			.overwrite(this->attachmentDeferredDescSet);

		NugieApp::DescriptorSet::Overwriter(NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT)
			.addBuffer(0, this->deferredUniform->getInfo())
			.addBuffer(1, this->materialModel->getInfo())
			.addBuffer(2, this->shadowTransformationModel->getInfo())
			.addBuffer(3, this->spotLightModel->getInfo())
			.addImage(4, this->spotShadowSubPartRenderer->getDepthInfoResources())
			.addImage(5, this->colorTextures[0]->getDescriptorInfo())
			.overwrite(this->modelDeferredDescSet);

		float aspectRatio = static_cast<float>(width) / static_cast<float>(height);
		this->camera->setAspect(aspectRatio);

		this->forwardUbo.cameraTransforms = this->camera->getProjectionMatrix() * this->camera->getViewMatrix();
		this->cameraUpdateCount = 0u;
	}
}