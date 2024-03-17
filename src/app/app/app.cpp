#include "app.hpp"

#include "../utils/load_model/load_model.hpp"

#include "../data/terrain/terrain_generation/fault_terrain_generation.hpp"
#include "../data/terrain/terrain_generation/flat_terrain_generation.hpp"
#include "../data/terrain/terrain_mesh/quads_terrain_mesh.hpp"
#include "../data/skybox/skybox.hpp"

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
		if (this->frustumCullRenderer != nullptr) delete this->frustumCullRenderer;
		if (this->resetCullRenderer != nullptr) delete this->resetCullRenderer;
		if (this->terrainRenderer != nullptr) delete this->terrainRenderer;
		if (this->forwardPassRenderer != nullptr) delete this->forwardPassRenderer;
		if (this->shadowPassRenderer != nullptr) delete this->shadowPassRenderer;
		if (this->skyboxRenderer != nullptr) delete this->skyboxRenderer;

		if (this->finalSubRenderer != nullptr) delete this->finalSubRenderer;
		if (this->shadowSubRenderer != nullptr) delete this->shadowSubRenderer;

		if (this->renderer != nullptr) delete this->renderer;

		if (this->frustumCullDescSet != nullptr) delete this->frustumCullDescSet;
		if (this->resetCullDescSet != nullptr) delete this->resetCullDescSet;
		if (this->terrainDescSet != nullptr) delete this->terrainDescSet;
		if (this->forwardDescSet != nullptr) delete this->forwardDescSet;
		if (this->shadowDescSet != nullptr) delete this->shadowDescSet;
		if (this->skyboxDescSet != nullptr) delete this->skyboxDescSet;

		if (this->frustumDataBuffer != nullptr) delete this->frustumDataBuffer;
		if (this->cameraTransformationBuffer != nullptr) delete this->cameraTransformationBuffer;
		if (this->tessellationDataBuffer != nullptr) delete this->tessellationDataBuffer;
		if (this->fragmentDataBuffer != nullptr) delete this->fragmentDataBuffer;

		if (this->drawCommandBuffer != nullptr) delete this->drawCommandBuffer;
		if (this->indexBuffer != nullptr) delete this->indexBuffer;
		if (this->vertexBuffer != nullptr) delete this->vertexBuffer;
		if (this->normTextBuffer != nullptr) delete this->normTextBuffer;
		if (this->referenceBuffer != nullptr) delete this->referenceBuffer;
		if (this->aabbBuffer != nullptr) delete this->aabbBuffer;

		if (this->skyboxIndicesBuffer != nullptr) delete this->skyboxIndicesBuffer;
		if (this->skyboxVerticesBuffer != nullptr) delete this->skyboxVerticesBuffer;
		
		if (this->materialBuffer != nullptr) delete this->materialBuffer;
		if (this->transformationBuffer != nullptr) delete this->transformationBuffer;
		if (this->shadowTransformationBuffer != nullptr) delete this->shadowTransformationBuffer;
		if (this->spotLightBuffer != nullptr) delete this->spotLightBuffer;
		
		for (auto &&colorTexture : this->colorTextures) {
			if (colorTexture != nullptr) delete colorTexture;
		}

		for (auto &&terrainTexture : this->terrainTextures) {
			if (terrainTexture != nullptr) delete terrainTexture;
		}

		if (this->heightMapTexture != nullptr) delete this->heightMapTexture;
		if (this->skyboxTexture != nullptr) delete this->skyboxTexture;

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

		for (auto &&terrainTexture : this->terrainTextures) {
			if (!terrainTexture->hasBeenMipmapped()) {
				terrainTexture->generateMipmap(prepareCommandBuffer);
			}
		}

		this->heightMapTexture->generateMipmap(prepareCommandBuffer);

		this->skyboxTexture->generateMipmap(prepareCommandBuffer);

		/* this->skyboxTexture->getImage()->transitionImageLayout(prepareCommandBuffer, VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL, VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL, 
      VK_PIPELINE_STAGE_TRANSFER_BIT, VK_PIPELINE_STAGE_FRAGMENT_SHADER_BIT, VK_ACCESS_TRANSFER_WRITE_BIT, VK_ACCESS_SHADER_READ_BIT); */

		prepareCommandBuffer->endCommand();

		uint32_t imageCount = static_cast<uint32_t>(this->renderer->getSwapChain()->getImageCount());

		std::vector<NugieVulkan::Buffer*> terrainBuffers;
		terrainBuffers.emplace_back(this->vertexBuffer->getBuffer());
		terrainBuffers.emplace_back(this->normTextBuffer->getBuffer());		

		std::vector<NugieVulkan::Buffer*> forwardBuffers;
		forwardBuffers.emplace_back(this->vertexBuffer->getBuffer());
		forwardBuffers.emplace_back(this->normTextBuffer->getBuffer());
		forwardBuffers.emplace_back(this->referenceBuffer->getBuffer());

		std::vector<NugieVulkan::Buffer*> shadowBuffers;
		shadowBuffers.emplace_back(this->vertexBuffer->getBuffer());
		shadowBuffers.emplace_back(this->referenceBuffer->getBuffer());		 
		
		std::vector<VkDeviceSize> forwardBufferOffsets;
		forwardBufferOffsets.emplace_back(this->verticeTerrainCount * sizeof(Vertex));
		forwardBufferOffsets.emplace_back(this->verticeTerrainCount * sizeof(NormText));
		forwardBufferOffsets.emplace_back(0);

		std::vector<VkDeviceSize> shadowBufferOffsets;
		shadowBufferOffsets.emplace_back(this->verticeTerrainCount * sizeof(Vertex));
		shadowBufferOffsets.emplace_back(0);

		uint32_t indexSize = this->indexBuffer->size() - this->indicesTerrainCount;
		uint32_t indexOffset = this->indicesTerrainCount * sizeof(uint32_t);

		for (uint32_t imageIndex = 0; imageIndex < imageCount; imageIndex++) {
			for (uint32_t frameIndex = 0; frameIndex < NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT; frameIndex++) {
				auto commandBuffer = this->renderer->beginRecordRenderCommand(frameIndex, imageIndex);

				this->frustumCullRenderer->render(commandBuffer, { this->frustumCullDescSet->getDescriptorSets(frameIndex) }, this->aabbBuffer->size() / 32, 1, 1);

				this->drawCommandBuffer->getBuffer(frameIndex)->transitionBuffer(commandBuffer, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_DRAW_INDIRECT_BIT, 
					VK_ACCESS_SHADER_WRITE_BIT, VK_ACCESS_INDIRECT_COMMAND_READ_BIT);

				for (uint32_t lightIndex = 0; lightIndex < this->spotNumLight; lightIndex++) {
					this->shadowSubRenderer->beginRenderPass(commandBuffer, frameIndex * this->spotNumLight + lightIndex);
					this->shadowPassRenderer->render(commandBuffer, { this->shadowDescSet->getDescriptorSets(frameIndex) }, shadowBuffers, this->indexBuffer->getBuffer(), indexSize, lightIndex, shadowBufferOffsets, indexOffset);
					this->shadowSubRenderer->endRenderPass(commandBuffer); 
				}				

				this->finalSubRenderer->beginRenderPass(commandBuffer, imageIndex);

				this->skyboxRenderer->render(commandBuffer, { this->skyboxDescSet->getDescriptorSets(frameIndex) }, { this->skyboxVerticesBuffer->getBuffer() }, this->skyboxIndicesBuffer->getBuffer(), this->skyboxIndicesBuffer->size());
				this->terrainRenderer->render(commandBuffer, { this->terrainDescSet->getDescriptorSets(frameIndex) }, terrainBuffers, this->indexBuffer->getBuffer(), this->drawCommandBuffer->getBuffer(frameIndex), this->drawCommandBuffer->size(), 0);
				this->forwardPassRenderer->render(commandBuffer, { this->forwardDescSet->getDescriptorSets(frameIndex) }, forwardBuffers, this->indexBuffer->getBuffer(), indexSize, forwardBufferOffsets, indexOffset);

				this->finalSubRenderer->endRenderPass(commandBuffer);

				this->drawCommandBuffer->getBuffer(frameIndex)->transitionBuffer(commandBuffer, VK_PIPELINE_STAGE_DRAW_INDIRECT_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
					VK_ACCESS_INDIRECT_COMMAND_READ_BIT, VK_ACCESS_SHADER_WRITE_BIT);

				this->resetCullRenderer->render(commandBuffer, { this->resetCullDescSet->getDescriptorSets(frameIndex) }, this->aabbBuffer->size() / 32, 1, 1);

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
					this->cameraTransformationBuffer->writeGlobalData(frameIndex, this->cameraTransformation);
					this->tessellationDataBuffer->writeGlobalData(frameIndex, this->tessellationData);
					this->fragmentDataBuffer->writeGlobalData(frameIndex, this->fragmentData);
					
					this->cameraUpdateCount++;
				}

				this->frustumData.drawObjectCount = 0;
				this->frustumDataBuffer->writeGlobalData(frameIndex, this->frustumData);

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

		for (uint32_t i = 0; i < NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT; i++) {
			this->cameraTransformationBuffer->writeGlobalData(i, this->cameraTransformation);
			this->tessellationDataBuffer->writeGlobalData(i, this->tessellationData);
			this->fragmentDataBuffer->writeGlobalData(i, this->fragmentData);
		}

		std::thread renderThread(&App::renderLoop, std::ref(*this));

		auto oldTime = std::chrono::high_resolution_clock::now();
		auto oldFpsTime = std::chrono::high_resolution_clock::now();

		while (!this->window->shouldClose()) {
			this->window->pollEvents();

			cameraPosition = this->camera->getPosition();
			cameraRotation = this->camera->getRotation();

			isMousePressed = false;
			isKeyboardPressed = false;

			auto newTime = std::chrono::high_resolution_clock::now();
			float deltaTime = std::chrono::duration<float, std::chrono::seconds::period>(newTime - oldTime).count();
			oldTime = newTime;

			cameraRotation = this->mouseController->rotateInPlaceXZ(this->window->getWindow(), deltaTime, cameraRotation, &isMousePressed);
			cameraPosition = this->keyboardController->moveInPlaceXZ(this->window->getWindow(), deltaTime, cameraPosition, this->camera->getDirection(), &isKeyboardPressed);

			if (isMousePressed || isKeyboardPressed) {
				this->camera->setViewYXZ(cameraPosition, cameraRotation);

				this->cameraTransformation.view = this->camera->getViewMatrix();
				this->cameraTransformation.projection = this->camera->getProjectionMatrix();
				
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
		glm::vec3 cameraPosition;
		glm::vec2 cameraRotation;

		bool isMousePressed = false, isKeyboardPressed = false;

		for (uint32_t i = 0; i < NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT; i++) {
			this->cameraTransformationBuffer->writeGlobalData(i, this->cameraTransformation);
			this->tessellationDataBuffer->writeGlobalData(i, this->tessellationData);
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
			cameraRotation = this->camera->getRotation();

			isMousePressed = false;
			isKeyboardPressed = false;

			auto newTime = std::chrono::high_resolution_clock::now();
			float deltaTime = std::chrono::duration<float, std::chrono::seconds::period>(newTime - oldTime).count();
			oldTime = newTime;

			cameraRotation = this->mouseController->rotateInPlaceXZ(this->window->getWindow(), deltaTime, cameraRotation, &isMousePressed);
			cameraPosition = this->keyboardController->moveInPlaceXZ(this->window->getWindow(), deltaTime, cameraPosition, this->camera->getDirection(), &isKeyboardPressed);

			if ((isMousePressed || isKeyboardPressed)) {
				this->camera->setViewYXZ(cameraPosition, cameraRotation);

				this->cameraTransformation.view = this->camera->getViewMatrix();
				this->cameraTransformation.projection = this->camera->getProjectionMatrix();
				
				this->cameraUpdateCount = 0u;
			}

			if (this->renderer->acquireFrame()) {
				uint32_t frameIndex = this->renderer->getFrameIndex();

				if (this->cameraUpdateCount < NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT) {
					this->cameraTransformationBuffer->writeGlobalData(frameIndex, this->cameraTransformation);
					this->tessellationDataBuffer->writeGlobalData(frameIndex, this->tessellationData);
					this->fragmentDataBuffer->writeGlobalData(frameIndex, this->fragmentData);

					this->cameraUpdateCount++;
				}

				this->frustumData.drawObjectCount = 0;
				this->frustumDataBuffer->writeGlobalData(frameIndex, this->frustumData);
				
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
		std::vector<Aabb> aabbs;	

		// ----------------------------------------------------------------------------

		uint32_t terrainSize = 256;
		uint32_t iterations = 250;
		uint32_t patchSize = 32;
		float minHeight = 0.0f;
		float maxHeight = 300.0f;
		float filter = 0.5f;
		float worldScale = 10.0f;
		
		TerrainPoints* terrainPoints = FlatTerrainGeneration(terrainSize, 100.0f).getTerrainPoints();

		QuadTerrainMesh quadMesh{};
		quadMesh.convertPointsToMeshes(terrainPoints, patchSize, worldScale);

		this->verticeTerrainCount = static_cast<uint32_t>(quadMesh.getVertices().size());
		this->indicesTerrainCount = static_cast<uint32_t>(quadMesh.getIndices().size());

		uint32_t indicesSize = static_cast<uint32_t>(indices.size());
		for (auto &&aabb : quadMesh.getAabbs()) {
			aabbs.emplace_back(aabb);
		}

		auto verticesSize = static_cast<uint32_t>(vertices.size());
		for (auto &&index : quadMesh.getIndices()) {
			indices.emplace_back(index);
		}		

		for (auto &&vertex : quadMesh.getVertices()) {
			vertices.emplace_back(vertex);
		}

		for (auto &&normText : quadMesh.getNormTexts()) {
			normTexts.emplace_back(normText);
		}

		// ----------------------------------------------------------------------------

		LoadedBuffer loadedBuffer = loadObjModel("../assets/models/box.obj");

		verticesSize = static_cast<uint32_t>(vertices.size());
		for (auto &&index : loadedBuffer.indices) {
			indices.emplace_back(index);
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

		transforms.emplace_back(TransformComponent{ glm::vec3(110.0f, 110.0f, 110.0f), glm::vec3(5.0f), glm::vec3(glm::radians(0.0f)) });

		// ----------------------------------------------------------------------------
		
		materials.emplace_back(Material{ glm::vec4{ 1.0f, 1.0f, 1.0f, 1.0f }, glm::vec4{ 0.0f, 0.0f, 0.0f, 0.0f }, 0u });
		materials.emplace_back(Material{ glm::vec4{ 1.0f, 1.0f, 1.0f, 1.0f }, glm::vec4{ 0.0f, 0.0f, 0.0f, 0.0f }, 1u });

		spotLights.resize(1);
		spotLights[0].position = glm::vec4{ 90.0f, 120.0f, 90.0f, 1.0f };
		spotLights[0].color = glm::vec4{ 8000.0f, 8000.0f, 8000.0f, 1.0f };
		spotLights[0].direction = glm::vec4(120.0f, 90.0f, 120.0f, 1.0f) - spotLights[0].position;
		spotLights[0].angle = 45;

		this->spotNumLight = static_cast<uint32_t>(spotLights.size());

		// ----------------------------------------------------------------------------

		this->fragmentData.numLights = glm::uvec4(this->spotNumLight, 0u, 0u, 0u);

		uint32_t width = this->renderer->getSwapChain()->getWidth();
		uint32_t height = this->renderer->getSwapChain()->getHeight();

		Camera shadowCamera;
		float near = 0.1f;
		float far = 2000.0f;
		float aspectRatio = static_cast<float>(width) / static_cast<float>(height);
		float theta = glm::radians(spotLights[0].angle);

		shadowCamera.setPerspectiveProjection(theta, aspectRatio, near, far);
		glm::mat4 projection = shadowCamera.getProjectionMatrix();

		shadowTransforms.resize(this->spotNumLight);

		for (size_t i = 0; i < spotLights.size(); i++) {
			shadowTransforms[i].projection = projection;

			shadowCamera.setViewDirection(spotLights[i].position, spotLights[i].direction);
			shadowTransforms[i].view = shadowCamera.getViewMatrix();
		}

		// ----------------------------------------------------------------------------

		uint32_t quadCount = static_cast<uint32_t>(quadMesh.getAabbs().size());
		std::vector<VkDrawIndexedIndirectCommand> drawCommands;
		drawCommands.resize(quadCount);

		// ----------------------------------------------------------------------------

		std::vector<uint32_t> skyboxIndices = SkyBox::getSkyBoxIndices();
		std::vector<glm::vec4> skyboxVertices = SkyBox::getSkyBoxVertices();

		std::string skyboxTexturFilenames[6] = {
			"../assets/textures/skybox/front.jpg",
			"../assets/textures/skybox/back.jpg",
			"../assets/textures/skybox/top.jpg",
			"../assets/textures/skybox/bottom.jpg",
			"../assets/textures/skybox/right.jpg",
			"../assets/textures/skybox/left.jpg"
		};

		// ----------------------------------------------------------------------------

		auto commandBuffer = this->renderer->beginRecordTransferCommand();

		this->indexBuffer = new ArrayBuffer<uint32_t>(this->device, VK_BUFFER_USAGE_INDEX_BUFFER_BIT, static_cast<uint32_t>(indices.size()));
		this->indexBuffer->replace(commandBuffer, indices);

		this->vertexBuffer = new ArrayBuffer<Vertex>(this->device, VK_BUFFER_USAGE_VERTEX_BUFFER_BIT, static_cast<uint32_t>(vertices.size()));
		this->vertexBuffer->replace(commandBuffer, vertices);

		this->normTextBuffer = new ArrayBuffer<NormText>(this->device, VK_BUFFER_USAGE_VERTEX_BUFFER_BIT, static_cast<uint32_t>(normTexts.size()));
		this->normTextBuffer->replace(commandBuffer, normTexts);

		this->aabbBuffer = new ArrayBuffer<Aabb>(this->device, VK_BUFFER_USAGE_STORAGE_BUFFER_BIT, static_cast<uint32_t>(aabbs.size()));
		this->aabbBuffer->replace(commandBuffer, aabbs);

		this->referenceBuffer = new ArrayBuffer<Reference>(this->device, VK_BUFFER_USAGE_VERTEX_BUFFER_BIT, static_cast<uint32_t>(references.size()));
		this->referenceBuffer->replace(commandBuffer, references);

		this->materialBuffer = new ArrayBuffer<Material>(this->device, VK_BUFFER_USAGE_STORAGE_BUFFER_BIT, static_cast<uint32_t>(materials.size()));
		this->materialBuffer->replace(commandBuffer, materials);

		this->transformationBuffer = new ArrayBuffer<Transformation>(this->device, VK_BUFFER_USAGE_STORAGE_BUFFER_BIT, static_cast<uint32_t>(transforms.size()));
		this->transformationBuffer->replace(commandBuffer, ConvertComponentToTransform(transforms));

		this->shadowTransformationBuffer = new ArrayBuffer<ShadowTransformation>(this->device, VK_BUFFER_USAGE_STORAGE_BUFFER_BIT, static_cast<uint32_t>(shadowTransforms.size()));
		this->shadowTransformationBuffer->replace(commandBuffer, shadowTransforms);

		this->spotLightBuffer = new ArrayBuffer<SpotLight>(this->device, VK_BUFFER_USAGE_STORAGE_BUFFER_BIT, static_cast<uint32_t>(spotLights.size()));
		this->spotLightBuffer->replace(commandBuffer, spotLights);

		this->drawCommandBuffer = new ManyArrayBuffer<VkDrawIndexedIndirectCommand>(this->device, VK_BUFFER_USAGE_INDIRECT_BUFFER_BIT | VK_BUFFER_USAGE_STORAGE_BUFFER_BIT, static_cast<uint32_t>(drawCommands.size()));
		this->drawCommandBuffer->replace(commandBuffer, drawCommands);

		this->skyboxIndicesBuffer = new ArrayBuffer<uint32_t>(this->device, VK_BUFFER_USAGE_INDEX_BUFFER_BIT, static_cast<uint32_t>(skyboxIndices.size()));
		this->skyboxIndicesBuffer->replace(commandBuffer, skyboxIndices);

		this->skyboxVerticesBuffer = new ArrayBuffer<glm::vec4>(this->device, VK_BUFFER_USAGE_VERTEX_BUFFER_BIT, static_cast<uint32_t>(skyboxVertices.size()));
		this->skyboxVerticesBuffer->replace(commandBuffer, skyboxVertices);

		this->colorTextures.emplace_back(new Texture(this->device, commandBuffer, "../assets/textures/smile.png"));
		this->terrainTextures.emplace_back(new Texture(this->device, commandBuffer, "../assets/textures/gray.jpg"));
		
		this->heightMapTexture = new HeightMapTexture(this->device, commandBuffer, terrainPoints->getAll());	
		this->skyboxTexture = new CubeMapTexture(this->device, commandBuffer, skyboxTexturFilenames);	

		commandBuffer->endCommand();
		this->renderer->submitTransferCommand();
	}

	void App::initCamera(uint32_t width, uint32_t height) {
		glm::vec3 position = glm::vec3(80.0f, 110.0f, 80.0f);
		glm::vec3 target = glm::vec3(400.0f, 110.0f, 400.0f);

		float near = 0.1f;
		float far = 2000.0f;

		float theta = glm::radians(45.0f);
		float aspectRatio = static_cast<float>(width) / static_cast<float>(height);

		this->camera->setPerspectiveProjection(theta, aspectRatio, near, far);
		this->camera->setViewTarget(position, target);

		glm::mat4 view = this->camera->getViewMatrix();
		glm::mat4 projection = this->camera->getProjectionMatrix();

		this->cameraTransformation.projection = projection;
		this->cameraTransformation.view = view;

		this->tessellationData.tessellatedEdgeSize = 32;
		this->tessellationData.tessellationFactor = 1.0f;
		this->tessellationData.screenSize = { width, height };

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

		this->cameraTransformationBuffer = new ObjectBuffer<CameraTransformation>(this->device, VK_BUFFER_USAGE_UNIFORM_BUFFER_BIT);
		this->tessellationDataBuffer = new ObjectBuffer<TessellationData>(this->device, VK_BUFFER_USAGE_UNIFORM_BUFFER_BIT);
		this->fragmentDataBuffer = new ObjectBuffer<FragmentData>(this->device, VK_BUFFER_USAGE_UNIFORM_BUFFER_BIT);
		this->frustumDataBuffer = new ObjectBuffer<FrustumData>(this->device, VK_BUFFER_USAGE_STORAGE_BUFFER_BIT);

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
			.addBuffer(0, VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, VK_SHADER_STAGE_VERTEX_BIT, this->cameraTransformationBuffer->getInfo())
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
			.addBuffer(0, VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, VK_SHADER_STAGE_TESSELLATION_CONTROL_BIT, this->cameraTransformationBuffer->getInfo())
			.addBuffer(1, VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, VK_SHADER_STAGE_TESSELLATION_CONTROL_BIT, this->tessellationDataBuffer->getInfo())
			.addBuffer(2, VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, VK_SHADER_STAGE_TESSELLATION_EVALUATION_BIT, this->cameraTransformationBuffer->getInfo())
			.addImage(3, VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER, VK_SHADER_STAGE_TESSELLATION_EVALUATION_BIT, this->heightMapTexture->getDescriptorInfo())
			.addBuffer(4, VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, VK_SHADER_STAGE_FRAGMENT_BIT, this->fragmentDataBuffer->getInfo())
			.addBuffer(5, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_FRAGMENT_BIT, this->shadowTransformationBuffer->getInfo())
			.addImage(6, VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER, VK_SHADER_STAGE_FRAGMENT_BIT, this->terrainTextures[0]->getDescriptorInfo())
			.addManyImage(7, VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER, VK_SHADER_STAGE_FRAGMENT_BIT, shadowImageInfos)
			.build();
		
		this->frustumCullDescSet = DescriptorSet::Builder(this->device, this->renderer->getDescriptorPool(), NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT)
			.addBuffer(0, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->drawCommandBuffer->getInfo())
			.addBuffer(1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->frustumDataBuffer->getInfo())
			.addBuffer(2, VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->cameraTransformationBuffer->getInfo())
			.addBuffer(3, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->aabbBuffer->getInfo())
			.build();

		this->resetCullDescSet = DescriptorSet::Builder(this->device, this->renderer->getDescriptorPool(), NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT)
			.addBuffer(0, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->drawCommandBuffer->getInfo())
			.build();

		this->skyboxDescSet = DescriptorSet::Builder(this->device, this->renderer->getDescriptorPool(), NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT)
			.addBuffer(0, VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, VK_SHADER_STAGE_VERTEX_BIT, this->cameraTransformationBuffer->getInfo())
			.addImage(1, VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER, VK_SHADER_STAGE_FRAGMENT_BIT, this->skyboxTexture->getDescriptorInfo())
			.build();
		
		this->forwardPassRenderer = new ForwardPassRenderSystem(this->device, { this->forwardDescSet->getDescSetLayout() }, this->finalSubRenderer->getRenderPass(), "shader/forward.vert.spv", "shader/forward.frag.spv");
		this->shadowPassRenderer = new ShadowPassRenderSystem(this->device, { this->shadowDescSet->getDescSetLayout() }, this->shadowSubRenderer->getRenderPass(), "shader/shadow_map.vert.spv");
		this->terrainRenderer = new TerrainPassRenderSystem(this->device, { this->terrainDescSet->getDescSetLayout() }, this->finalSubRenderer->getRenderPass(), "shader/terrain.vert.spv", "shader/terrain.tesc.spv", 
			"shader/terrain.tese.spv", "shader/terrain.frag.spv");
		this->frustumCullRenderer = new ComputeRenderSystem(this->device, { this->frustumCullDescSet->getDescSetLayout() }, "shader/frustum_cull.comp.spv");
		this->resetCullRenderer = new ComputeRenderSystem(this->device, { this->resetCullDescSet->getDescSetLayout() }, "shader/reset_cull.comp.spv");
		this->skyboxRenderer = new SkyboxPassRenderSystem(this->device, { this->skyboxDescSet->getDescSetLayout() }, this->finalSubRenderer->getRenderPass(), "shader/skybox.vert.spv", "shader/skybox.frag.spv");

		this->forwardPassRenderer->initialize();
		this->shadowPassRenderer->initialize();
		this->terrainRenderer->initialize();
		this->frustumCullRenderer->initialize();
		this->resetCullRenderer->initialize();
		this->skyboxRenderer->initialize();
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

		this->cameraTransformation.view = this->camera->getViewMatrix();
		this->cameraTransformation.projection = this->camera->getProjectionMatrix();
		this->tessellationData.screenSize = { width, height };

		this->cameraUpdateCount = 0u;
		
		this->recordCommand();
	}
}