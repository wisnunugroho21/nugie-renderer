#include "app.hpp"

#include "../utils/load_model/load_model.hpp"

#include "../data/terrain/terrain_generation/fault_terrain_generation.hpp"
#include "../data/terrain/terrain_mesh/terrain_mesh.hpp"

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
		if (this->terrainRenderer != nullptr) delete this->terrainRenderer;
		if (this->forwardPassRenderer != nullptr) delete this->forwardPassRenderer;
		if (this->shadowPassRenderer != nullptr) delete this->shadowPassRenderer;

		if (this->finalSubRenderer != nullptr) delete this->finalSubRenderer;
		if (this->shadowSubRenderer != nullptr) delete this->shadowSubRenderer;

		if (this->renderer != nullptr) delete this->renderer;

		if (this->terrainDescSet != nullptr) delete this->terrainDescSet;
		if (this->forwardDescSet != nullptr) delete this->forwardDescSet;
		if (this->shadowDescSet != nullptr) delete this->shadowDescSet;

		if (this->vertexDataBuffer != nullptr) delete this->vertexDataBuffer;
		if (this->fragmentDataBuffer != nullptr) delete this->fragmentDataBuffer;

		if (this->indexBuffer != nullptr) delete this->indexBuffer;
		if (this->vertexBuffer != nullptr) delete this->vertexBuffer;
		if (this->normTextBuffer != nullptr) delete this->normTextBuffer;
		if (this->referenceBuffer != nullptr) delete this->referenceBuffer;

		if (this->terrainIndexBuffer != nullptr) delete this->terrainIndexBuffer;
		if (this->terrainVertexBuffer != nullptr) delete this->terrainVertexBuffer;
		if (this->terrainNormTextBuffer != nullptr) delete this->terrainNormTextBuffer;
		
		if (this->materialBuffer != nullptr) delete this->materialBuffer;
		if (this->transformationBuffer != nullptr) delete this->transformationBuffer;
		if (this->shadowTransformationBuffer != nullptr) delete this->shadowTransformationBuffer;
		if (this->spotLightBuffer != nullptr) delete this->spotLightBuffer;
		
		for (auto &&colorTexture : this->colorTextures) {
			if (colorTexture != nullptr) delete colorTexture;
		}

		for (auto &&terrainTexture : this->lowTerrainTextures) {
			if (terrainTexture != nullptr) delete terrainTexture;
		}

		for (auto &&terrainTexture : this->midTerrainTextures) {
			if (terrainTexture != nullptr) delete terrainTexture;
		}

		for (auto &&terrainTexture : this->highTerrainTextures) {
			if (terrainTexture != nullptr) delete terrainTexture;
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

		for (auto &&terrainTexture : this->lowTerrainTextures) {
			if (!terrainTexture->hasBeenMipmapped()) {
				terrainTexture->generateMipmap(prepareCommandBuffer);
			}
		}

		for (auto &&terrainTexture : this->midTerrainTextures) {
			if (!terrainTexture->hasBeenMipmapped()) {
				terrainTexture->generateMipmap(prepareCommandBuffer);
			}
		}

		for (auto &&terrainTexture : this->highTerrainTextures) {
			if (!terrainTexture->hasBeenMipmapped()) {
				terrainTexture->generateMipmap(prepareCommandBuffer);
			}
		}

		prepareCommandBuffer->endCommand();

		uint32_t imageCount = static_cast<uint32_t>(this->renderer->getSwapChain()->getImageCount());

		std::vector<NugieVulkan::Buffer*> terrainBuffers;
		terrainBuffers.emplace_back(this->terrainVertexBuffer->getBuffer());
		terrainBuffers.emplace_back(this->terrainNormTextBuffer->getBuffer());

		/* std::vector<NugieVulkan::Buffer*> forwardBuffers;
		forwardBuffers.emplace_back(this->vertexBuffer->getBuffer());
		forwardBuffers.emplace_back(this->normTextBuffer->getBuffer());
		forwardBuffers.emplace_back(this->referenceBuffer->getBuffer());

		std::vector<NugieVulkan::Buffer*> shadowBuffers;
		shadowBuffers.emplace_back(this->vertexBuffer->getBuffer());
		shadowBuffers.emplace_back(this->referenceBuffer->getBuffer()); */

		for (uint32_t imageIndex = 0; imageIndex < imageCount; imageIndex++) {
			for (uint32_t frameIndex = 0; frameIndex < NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT; frameIndex++) {
				auto commandBuffer = this->renderer->beginRecordRenderCommand(frameIndex, imageIndex);

				/* for (uint32_t lightIndex = 0; lightIndex < this->spotNumLight; lightIndex++) {
					this->shadowSubRenderer->beginRenderPass(commandBuffer, frameIndex * this->spotNumLight + lightIndex);
					this->shadowPassRenderer->render(commandBuffer, { this->shadowDescSet->getDescriptorSets(frameIndex) }, shadowBuffers, this->indexBuffer->getBuffer(), this->indexBuffer->size(), lightIndex);
					this->shadowSubRenderer->endRenderPass(commandBuffer);
				} */

				this->finalSubRenderer->beginRenderPass(commandBuffer, imageIndex);
				this->terrainRenderer->render(commandBuffer, { this->terrainDescSet->getDescriptorSets(frameIndex) }, terrainBuffers, this->terrainIndexBuffer->getBuffer(), this->terrainIndexBuffer->size());
				// this->forwardPassRenderer->render(commandBuffer, { this->forwardDescSet->getDescriptorSets(frameIndex) }, forwardBuffers, this->indexBuffer->getBuffer(), this->indexBuffer->size());
				this->finalSubRenderer->endRenderPass(commandBuffer);

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
					this->vertexDataBuffer->writeGlobalData(frameIndex, this->vertexData);
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
			this->vertexDataBuffer->writeGlobalData(i, this->vertexData);
			this->fragmentDataBuffer->writeGlobalData(i, this->fragmentData);
		}

		std::thread renderThread(&App::renderLoop, std::ref(*this));

		auto oldTime = std::chrono::high_resolution_clock::now();
		auto oldFpsTime = std::chrono::high_resolution_clock::now();

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
				this->vertexData.cameraTransforms = this->camera->getProjectionMatrix() * this->camera->getViewMatrix();
				
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
			this->vertexDataBuffer->writeGlobalData(i, this->vertexData);
			this->fragmentDataBuffer->writeGlobalData(i, this->fragmentData);
		}

		std::vector<NugieVulkan::Buffer*> forwardBuffers;
		forwardBuffers.emplace_back(this->vertexBuffer->getBuffer());
		forwardBuffers.emplace_back(this->normTextBuffer->getBuffer());
		forwardBuffers.emplace_back(this->referenceBuffer->getBuffer());

		std::vector<NugieVulkan::Buffer*> shadowBuffers;
		shadowBuffers.emplace_back(this->vertexBuffer->getBuffer());
		shadowBuffers.emplace_back(this->referenceBuffer->getBuffer());

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
				this->vertexData.cameraTransforms = this->camera->getProjectionMatrix() * this->camera->getViewMatrix();
				
				this->cameraUpdateCount = 0u;
			}

			if (this->renderer->acquireFrame()) {
				uint32_t frameIndex = this->renderer->getFrameIndex();

				if (this->cameraUpdateCount < NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT) {
					this->vertexDataBuffer->writeGlobalData(frameIndex, this->vertexData);
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
		std::vector<NormText> normTexts;
		std::vector<Reference> references;
		std::vector<Material> materials;
		std::vector<TransformComponent> transforms;
		std::vector<ShadowTransformation> shadowTransforms;
		std::vector<uint32_t> indices;
		std::vector<SpotLight> spotLights;
		
		std::vector<uint32_t> terrainIndices;
		std::vector<Vertex> terrainVertices;
		std::vector<NormText> terrainNormTexts;

		// ----------------------------------------------------------------------------

		int size = 256;
		int iterations = 500;
		float minHeight = 0.0f;
		float maxHeight = 300.0f;
		float filter = 0.5f;

		TerrainMesh terrainMesh = TerrainMesh::convertPointsToMeshes(
			(FaultTerrainGeneration(size, iterations, minHeight, maxHeight, filter).getTerrainPoints())
		); //loadTerrain("../assets/terrain/heightmap.save");

		auto vertexSize = static_cast<uint32_t>(vertices.size());
		for (auto &&index : terrainMesh.indices) {
			terrainIndices.emplace_back(vertexSize + index);
		}

		for (auto &&vertex : terrainMesh.vertices) {
			terrainVertices.emplace_back(vertex);
		}

		for (auto &&normText : terrainMesh.normTexts) {
			terrainNormTexts.emplace_back(normText);
		}

		/* LoadedBuffer loadedBuffer = loadObjModel("../assets/models/viking_room.obj");

		auto verticesSize = static_cast<uint32_t>(vertices.size());
		for (auto &&index : loadedBuffer.indices) {
			indices.emplace_back(verticesSize + index);
		}

		for (auto &&vertex : loadedBuffer.vertices) {
			vertices.emplace_back(vertex);
		}

		for (auto &&normText : loadedBuffer.normTexts) {
			normTexts.emplace_back(normText);
		}

		for (size_t i = 0; i < loadedBuffer.vertices.size(); i++) {
			references.emplace_back(Reference{ 1, 0 });
		}

		transforms.emplace_back(TransformComponent{ glm::vec3(0.0f, 10.0f, 0.0f), glm::vec3(10.0f), glm::vec3(glm::radians(270.0f), glm::radians(90.0f), glm::radians(0.0f)) });

		// ----------------------------------------------------------------------------

		loadedBuffer = loadObjModel("../assets/models/quad_model.obj");

		verticesSize = static_cast<uint32_t>(vertices.size());
		for (auto &&index : loadedBuffer.indices) {
			indices.emplace_back(verticesSize + index);
		}

		for (auto &&vertex : loadedBuffer.vertices) {
			vertices.emplace_back(vertex);
		}

		for (auto &&normText : loadedBuffer.normTexts) {
			normTexts.emplace_back(normText);
		}

		for (size_t i = 0; i < loadedBuffer.vertices.size(); i++) {
			references.emplace_back(Reference{ 0, 1 });
		}

		transforms.emplace_back(TransformComponent{ glm::vec3(0.0f), glm::vec3(50.0f), glm::vec3(glm::radians(0.0f), glm::radians(0.0f), glm::radians(0.0f)) }); */

		// ----------------------------------------------------------------------------

		transforms.emplace_back(TransformComponent{ glm::vec3(0.0f), glm::vec3(0.0f), glm::vec3(glm::radians(0.0f)) });
		
		materials.emplace_back(Material{ glm::vec4{ 1.0f, 1.0f, 1.0f, 1.0f }, glm::vec4{ 0.0f, 0.0f, 0.0f, 0.0f }, 0u });
		materials.emplace_back(Material{ glm::vec4{ 1.0f, 1.0f, 1.0f, 1.0f }, glm::vec4{ 0.0f, 0.0f, 0.0f, 0.0f }, 1u });

		spotLights.resize(1);
		spotLights[0].position = glm::vec4{ 0.0f, 30.0f, -30.0f, 1.0f };
		spotLights[0].color = glm::vec4{ 50000.0f, 50000.0f, 50000.0f, 1.0f };
		spotLights[0].direction = glm::vec4(0.0f, 0.0f, 0.0f, 0.0f) - spotLights[0].position;
		spotLights[0].angle = 60;

		this->spotNumLight = static_cast<uint32_t>(spotLights.size());

		// ---------------------------------------------------------------------

		this->fragmentData.numLights = glm::uvec4(this->spotNumLight, 0u, 0u, 0u);

		uint32_t width = this->renderer->getSwapChain()->getWidth();
		uint32_t height = this->renderer->getSwapChain()->getHeight();

		Camera shadowCamera;
		float near = 0.1f;
		float far = 2000.0f;
		float aspectRatio = static_cast<float>(width) / static_cast<float>(height);
		float theta = glm::radians(45.0);

		shadowCamera.setPerspectiveProjection(theta, aspectRatio, near, far);
		glm::mat4 projection = shadowCamera.getProjectionMatrix();

		shadowTransforms.resize(this->spotNumLight);

		for (size_t i = 0; i < spotLights.size(); i++) {
			shadowCamera.setViewDirection(spotLights[i].position, spotLights[i].direction, glm::vec3(0.0f, 0.0f, 1.0f));
			shadowTransforms[i].viewProjectionMatrix = projection * shadowCamera.getViewMatrix();
		}

		// ----------------------------------------------------------------------------

		auto commandBuffer = this->renderer->beginRecordTransferCommand();

		/* this->indexBuffer = new ArrayBuffer<uint32_t>(this->device, VK_BUFFER_USAGE_INDEX_BUFFER_BIT, static_cast<uint32_t>(indices.size()));
		this->indexBuffer->replace(commandBuffer, indices);

		this->vertexBuffer = new ArrayBuffer<Vertex>(this->device, VK_BUFFER_USAGE_VERTEX_BUFFER_BIT, static_cast<uint32_t>(vertices.size()));
		this->vertexBuffer->replace(commandBuffer, vertices);

		this->normTextBuffer = new ArrayBuffer<NormText>(this->device, VK_BUFFER_USAGE_VERTEX_BUFFER_BIT, static_cast<uint32_t>(normTexts.size()));
		this->normTextBuffer->replace(commandBuffer, normTexts);

		this->referenceBuffer = new ArrayBuffer<Reference>(this->device, VK_BUFFER_USAGE_VERTEX_BUFFER_BIT, static_cast<uint32_t>(references.size()));
		this->referenceBuffer->replace(commandBuffer, references); */

		this->terrainIndexBuffer = new ArrayBuffer<uint32_t>(this->device, VK_BUFFER_USAGE_INDEX_BUFFER_BIT, static_cast<uint32_t>(terrainIndices.size()));
		this->terrainIndexBuffer->replace(commandBuffer, terrainIndices);

		this->terrainVertexBuffer = new ArrayBuffer<Vertex>(this->device, VK_BUFFER_USAGE_VERTEX_BUFFER_BIT, static_cast<uint32_t>(terrainVertices.size()));
		this->terrainVertexBuffer->replace(commandBuffer, terrainVertices);

		this->terrainNormTextBuffer = new ArrayBuffer<NormText>(this->device, VK_BUFFER_USAGE_VERTEX_BUFFER_BIT, static_cast<uint32_t>(terrainNormTexts.size()));
		this->terrainNormTextBuffer->replace(commandBuffer, terrainNormTexts);

		this->materialBuffer = new ArrayBuffer<Material>(this->device, VK_BUFFER_USAGE_STORAGE_BUFFER_BIT, static_cast<uint32_t>(materials.size()));
		this->materialBuffer->replace(commandBuffer, materials);

		this->transformationBuffer = new ArrayBuffer<Transformation>(this->device, VK_BUFFER_USAGE_STORAGE_BUFFER_BIT, static_cast<uint32_t>(transforms.size()));
		this->transformationBuffer->replace(commandBuffer, ConvertComponentToTransform(transforms));

		this->shadowTransformationBuffer = new ArrayBuffer<ShadowTransformation>(this->device, VK_BUFFER_USAGE_STORAGE_BUFFER_BIT, static_cast<uint32_t>(shadowTransforms.size()));
		this->shadowTransformationBuffer->replace(commandBuffer, shadowTransforms);

		this->spotLightBuffer = new ArrayBuffer<SpotLight>(this->device, VK_BUFFER_USAGE_STORAGE_BUFFER_BIT, static_cast<uint32_t>(spotLights.size()));
		this->spotLightBuffer->replace(commandBuffer, spotLights);

		this->colorTextures.resize(1);
		this->colorTextures[0] = new Texture(this->device, commandBuffer, "../assets/textures/viking_room.png");

		this->lowTerrainTextures.emplace_back(new Texture(this->device, commandBuffer, "../assets/textures/snow.jpg"));
		this->midTerrainTextures.emplace_back(new Texture(this->device, commandBuffer, "../assets/textures/grass.png"));
		this->highTerrainTextures.emplace_back(new Texture(this->device, commandBuffer, "../assets/textures/rock.jpg"));

		commandBuffer->endCommand();
		this->renderer->submitTransferCommand();
	}

	void App::initCamera(uint32_t width, uint32_t height) {
		glm::vec3 position = glm::vec3(200.0f, 300.0f, -150.0f);
		glm::vec3 target = glm::vec3(0.0f, -0.35f, 1.0f);
		glm::vec3 vup = glm::vec3(0.0f, 1.0f, 0.0f);

		float near = 0.1f;
		float far = 2000.0f;

		float theta = glm::radians(45.0f);
		float aspectRatio = static_cast<float>(width) / static_cast<float>(height);

		this->camera->setPerspectiveProjection(theta, aspectRatio, near, far);
		this->camera->setViewTarget(position, target, vup);

		glm::mat4 view = this->camera->getViewMatrix();
		glm::mat4 projection = this->camera->getProjectionMatrix();

		this->vertexData.cameraTransforms = projection * view;
		this->fragmentData.origin = glm::vec4(position, 1.0f);

		this->fragmentData.sunLight.direction = glm::normalize(glm::vec4(0.0f, -1.0f, 0.0f, 0.0f));
		this->fragmentData.sunLight.color = glm::vec4(3.0f, 3.0f, 3.0f, 1.0f);
	}

	void App::init() {
		uint32_t width = this->renderer->getSwapChain()->getWidth();
		uint32_t height = this->renderer->getSwapChain()->getHeight();
		uint32_t imageCount = static_cast<uint32_t>(this->renderer->getSwapChain()->getImageCount());
		VkSampleCountFlagBits msaaSample = this->device->getMSAASamples();

		this->initCamera(width, height);

		this->vertexDataBuffer = new ObjectBuffer<VertexData>(this->device, VK_BUFFER_USAGE_UNIFORM_BUFFER_BIT);
		this->fragmentDataBuffer = new ObjectBuffer<FragmentData>(this->device, VK_BUFFER_USAGE_UNIFORM_BUFFER_BIT);

		this->finalSubRenderer = SubRenderer::Builder(this->device, width, height, imageCount)
			.addAttachment(AttachmentType::KEEPED, this->renderer->getSwapChain()->getSwapChainImageFormat(), 
				VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL, msaaSample)
			.setDepthAttachment(AttachmentType::KEEPED, VK_FORMAT_D16_UNORM, 
				VK_IMAGE_LAYOUT_DEPTH_STENCIL_ATTACHMENT_OPTIMAL, msaaSample)
			.addResolvedAttachment(this->renderer->getSwapChain()->getswapChainImages(), AttachmentType::OUTPUT_STORED,
				this->renderer->getSwapChain()->getSwapChainImageFormat(), VK_IMAGE_LAYOUT_PRESENT_SRC_KHR)
			.build();

		this->shadowSubRenderer = SubRenderer::Builder(this->device, SHADOW_RESOLUTION, SHADOW_RESOLUTION, this->spotNumLight * NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT)
			.setDepthAttachment(AttachmentType::OUTPUT_TEXTURE, VK_FORMAT_D16_UNORM, VK_IMAGE_LAYOUT_DEPTH_STENCIL_READ_ONLY_OPTIMAL, VK_SAMPLE_COUNT_1_BIT)
			.build();

		std::vector<std::vector<VkDescriptorImageInfo>> shadowImageInfos;
		for (uint32_t frameIndex = 0; frameIndex < NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT; frameIndex++) {
			std::vector<VkDescriptorImageInfo> shadowFrameImageInfos;

			for (uint32_t lightIndex = 0; lightIndex < this->spotNumLight; lightIndex++) {
				shadowFrameImageInfos.emplace_back(this->shadowSubRenderer->getAttachmentInfos(0)[0][frameIndex * this->spotNumLight + lightIndex]);
			}

			shadowImageInfos.emplace_back(shadowFrameImageInfos);
		}

		this->forwardDescSet = DescriptorSet::Builder(this->device, this->renderer->getDescriptorPool(), NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT)
			.addBuffer(0, VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, VK_SHADER_STAGE_VERTEX_BIT, this->vertexDataBuffer->getInfo())
			.addBuffer(1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_VERTEX_BIT, this->transformationBuffer->getInfo())
			.addBuffer(2, VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, VK_SHADER_STAGE_FRAGMENT_BIT, this->fragmentDataBuffer->getInfo())
			.addBuffer(3, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_FRAGMENT_BIT, this->materialBuffer->getInfo())
			.addBuffer(4, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_FRAGMENT_BIT, this->spotLightBuffer->getInfo())
			.addBuffer(5, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_FRAGMENT_BIT, this->shadowTransformationBuffer->getInfo())
			.addImage(6, VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER, VK_SHADER_STAGE_FRAGMENT_BIT, this->colorTextures[0]->getDescriptorInfo())
			.addManyImage(7, VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER, VK_SHADER_STAGE_FRAGMENT_BIT, shadowImageInfos)
			.build();

		this->shadowDescSet = DescriptorSet::Builder(this->device, this->renderer->getDescriptorPool(), NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT)
			.addBuffer(0, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_VERTEX_BIT, this->transformationBuffer->getInfo())
			.addBuffer(1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_VERTEX_BIT, this->shadowTransformationBuffer->getInfo())
			.build();

		this->terrainDescSet = DescriptorSet::Builder(this->device, this->renderer->getDescriptorPool(), NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT)
			.addBuffer(0, VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, VK_SHADER_STAGE_VERTEX_BIT, this->vertexDataBuffer->getInfo())
			.addBuffer(1, VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, VK_SHADER_STAGE_FRAGMENT_BIT, this->fragmentDataBuffer->getInfo())
			.addBuffer(2, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_FRAGMENT_BIT, this->spotLightBuffer->getInfo())
			.addImage(3, VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER, VK_SHADER_STAGE_FRAGMENT_BIT, this->lowTerrainTextures[0]->getDescriptorInfo())
			.addImage(4, VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER, VK_SHADER_STAGE_FRAGMENT_BIT, this->midTerrainTextures[0]->getDescriptorInfo())
			.addImage(5, VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER, VK_SHADER_STAGE_FRAGMENT_BIT, this->highTerrainTextures[0]->getDescriptorInfo())
			.build();
		
		this->forwardPassRenderer = new ForwardPassRenderSystem(this->device, { this->forwardDescSet->getDescSetLayout() }, this->finalSubRenderer->getRenderPass(), "shader/forward.vert.spv", "shader/forward.frag.spv");
		this->shadowPassRenderer = new ShadowPassRenderSystem(this->device, { this->shadowDescSet->getDescSetLayout() }, this->shadowSubRenderer->getRenderPass(), "shader/shadow_map.vert.spv");
		this->terrainRenderer = new TerrainPassRenderSystem(this->device, { this->terrainDescSet->getDescSetLayout() }, this->finalSubRenderer->getRenderPass(), "shader/terrain.vert.spv", "shader/terrain.frag.spv");

		this->forwardPassRenderer->initialize();
		this->shadowPassRenderer->initialize();
		this->terrainRenderer->initialize();
	}

	void App::resize() {
		uint32_t width = this->renderer->getSwapChain()->getWidth();
		uint32_t height = this->renderer->getSwapChain()->getHeight();
		uint32_t imageCount = static_cast<uint32_t>(this->renderer->getSwapChain()->getImageCount());
		VkSampleCountFlagBits msaaSample = this->device->getMSAASamples();

		this->renderer->resetCommandPool();

		SubRenderer::Overwriter(this->device, width, height, imageCount)
			.addOutsideAttachment(this->renderer->getSwapChain()->getswapChainImages())
			.overwrite(this->finalSubRenderer);

		float aspectRatio = static_cast<float>(width) / static_cast<float>(height);
		this->camera->setAspect(aspectRatio);

		this->vertexData.cameraTransforms = this->camera->getProjectionMatrix() * this->camera->getViewMatrix();
		this->cameraUpdateCount = 0u;
		
		this->recordCommand();
	}
}