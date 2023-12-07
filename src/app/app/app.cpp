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
		this->renderer = new HybridRenderer(this->window, this->device);

		this->camera = new Camera();

		this->loadObjects();
		this->recreateSubRendererAndSubsystem();
	}

	App::~App() {
		if (this->forwardPassRenderer != nullptr) delete this->forwardPassRenderer;
		if (this->deferredPasRenderer != nullptr) delete this->deferredPasRenderer;
		if (this->shadowPassRenderer != nullptr) delete this->shadowPassRenderer;

		if (this->forwardSubPartRenderer != nullptr) delete this->forwardSubPartRenderer;
		if (this->deferredSubPartRenderer != nullptr) delete this->deferredSubPartRenderer;
		if (this->shadowSubPartRenderer != nullptr) delete this->shadowSubPartRenderer;

		if (this->finalSubRenderer != nullptr) delete this->finalSubRenderer;
		if (this->renderer != nullptr) delete this->renderer;

		if (this->shadowDescSet != nullptr) delete this->shadowDescSet;
		if (this->forwardDescSet != nullptr) delete this->forwardDescSet;
		if (this->attachmentDeferredDescSet != nullptr) delete this->attachmentDeferredDescSet;
		if (this->modelDeferredDescSet != nullptr) delete this->modelDeferredDescSet;

		if (this->shadowUniform != nullptr) delete this->shadowUniform;
		if (this->forwardUniform != nullptr) delete this->forwardUniform;
		if (this->deferredUniform != nullptr) delete this->deferredUniform;

		if (this->indexModel != nullptr) delete this->indexModel;
		if (this->positionModel != nullptr) delete this->positionModel;
		if (this->normalModel != nullptr) delete this->normalModel;
		if (this->textCoordModel != nullptr) delete this->textCoordModel;
		if (this->referenceModel != nullptr) delete this->referenceModel;
		if (this->materialModel != nullptr) delete this->materialModel;
		if (this->transformationModel != nullptr) delete this->transformationModel;
		if (this->pointLightModel != nullptr) delete this->pointLightModel;

		if (this->colorTexture != nullptr) delete this->colorTexture;

		if (this->device != nullptr) delete this->device;
		if (this->window != nullptr) delete this->window;

		if (this->camera != nullptr) delete this->camera;
	}

	void App::renderLoop() {
		std::vector<NugieVulkan::Buffer*> forwardBuffers;
		forwardBuffers.emplace_back(this->positionModel->getBuffer());
		forwardBuffers.emplace_back(this->normalModel->getBuffer());
		forwardBuffers.emplace_back(this->textCoordModel->getBuffer());
		forwardBuffers.emplace_back(this->referenceModel->getBuffer());

		std::vector<NugieVulkan::Buffer*> shadowBuffers;
		shadowBuffers.emplace_back(this->positionModel->getBuffer());
		shadowBuffers.emplace_back(this->referenceModel->getBuffer());

		while (this->isRendering) {
			auto oldTime = std::chrono::high_resolution_clock::now();

			if (this->renderer->acquireFrame()) {
				uint32_t frameIndex = this->renderer->getFrameIndex();
				uint32_t imageIndex = this->renderer->getImageIndex();

				std::vector<VkDescriptorSet> descriptorSets;
				descriptorSets.emplace_back(this->attachmentDeferredDescSet->getDescriptorSets(imageIndex));
				descriptorSets.emplace_back(this->modelDeferredDescSet->getDescriptorSets(frameIndex));

				auto commandBuffer = this->renderer->beginRenderCommand();

				if (!this->colorTexture->hasBeenMipmapped()) {
					this->colorTexture->generateMipmap(commandBuffer);
				}

				this->shadowSubRenderer->beginRenderPass(commandBuffer, frameIndex);
				this->shadowPassRenderer->render(commandBuffer, this->shadowDescSet->getDescriptorSets(frameIndex), shadowBuffers, this->indexModel->getBuffer(), this->indexModel->getIndexCount(), {});
				this->shadowSubRenderer->endRenderPass(commandBuffer);

				this->finalSubRenderer->beginRenderPass(commandBuffer, imageIndex);

				this->forwardPassRenderer->render(commandBuffer, this->forwardDescSet->getDescriptorSets(frameIndex), forwardBuffers, this->indexModel->getBuffer(), this->indexModel->getIndexCount());
				this->finalSubRenderer->nextSubpass(commandBuffer, VK_SUBPASS_CONTENTS_INLINE);
				this->deferredPasRenderer->render(commandBuffer, descriptorSets);

				this->finalSubRenderer->endRenderPass(commandBuffer);

				this->renderer->endRenderCommand(commandBuffer);
				this->renderer->submitRenderCommand(commandBuffer);

				if (!this->renderer->presentFrame()) {
					this->recreateSubRendererAndSubsystem();
					this->randomSeed = 0;

					continue;
				}				

				if (frameIndex + 1 == NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT) {
					this->randomSeed++;
				}				
			}

			auto newTime = std::chrono::high_resolution_clock::now();
			this->frameTime = std::chrono::duration<float, std::chrono::seconds::period>(newTime - oldTime).count();
		}
	}

	void App::run() {
		auto currentTime = std::chrono::high_resolution_clock::now();
		uint32_t t = 0;

		this->forwardUniform->writeGlobalData(0, this->forwardUbo);
		this->deferredUniform->writeGlobalData(0, this->deferredUbo);
		this->shadowUniform->writeGlobalData(0, this->shadowUbo);

		std::thread renderThread(&App::renderLoop, std::ref(*this));

		while (!this->window->shouldClose()) {
			this->window->pollEvents();

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

	void App::loadObjects() {
		std::vector<Position> positions;
		std::vector<Normal> normals;
		std::vector<TextCoord> textCoords;
		std::vector<Reference> references;
		std::vector<Material> materials;
		std::vector<TransformComponent> transforms;
		std::vector<uint32_t> indices;
		std::vector<PointLight> lights;

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

		PointLight light{};
		light.position = glm::vec4{ 0.0f, 50.0f, -50.0f, 1.0f };
		light.color = glm::vec4{ 100000.0f, 100000.0f, 100000.0f, 1.0f };
		
		lights.emplace_back(light);

		// ----------------------------------------------------------------------------

		auto commandBuffer = this->renderer->beginTransferCommand();

		this->positionModel = new PositionModel(this->device);
		this->positionModel->update(commandBuffer, positions);

		this->normalModel = new NormalModel(this->device);
		this->normalModel->update(commandBuffer, normals);

		this->textCoordModel = new TextCoordModel(this->device);
		this->textCoordModel->update(commandBuffer, textCoords);

		this->indexModel = new IndexModel(this->device);
		this->indexModel->update(commandBuffer, indices);

		this->referenceModel = new ReferenceModel(this->device);
		this->referenceModel->update(commandBuffer, references);

		this->materialModel = new MaterialModel(this->device);
		this->materialModel->update(commandBuffer, materials);

		this->transformationModel = new TransformationModel(this->device);
		this->transformationModel->update(commandBuffer, transforms);

		this->pointLightModel = new PointLightModel(this->device);
		this->pointLightModel->update(commandBuffer, lights);

		this->colorTexture = new NugieVulkan::Texture(this->device, commandBuffer, "../assets/textures/viking_room.png", VK_FILTER_LINEAR, 
			VK_SAMPLER_ADDRESS_MODE_REPEAT, VK_TRUE, VK_BORDER_COLOR_FLOAT_OPAQUE_BLACK, VK_COMPARE_OP_NEVER, VK_SAMPLER_MIPMAP_MODE_LINEAR);

		this->renderer->endTransferCommand(commandBuffer);
		this->renderer->submitTransferCommand(commandBuffer);

		this->numLight = static_cast<uint32_t>(lights.size());

		// ---------------------------------------------------------------------

		uint32_t width = this->renderer->getSwapChain()->width();
		uint32_t height = this->renderer->getSwapChain()->height();

		Camera shadowCamera;
		float near = 0.1f;
		float far = 2000.0f;
		float aspectRatio = static_cast<float>(width) / static_cast<float>(height);
		float theta = glm::radians(90.0f);

		shadowCamera.setPerspectiveProjection(theta, aspectRatio, near, far);
		glm::mat4 projection = shadowCamera.getProjectionMatrix();

		glm::vec3 direction = glm::vec3(1.0f, 0.0f, 0.0f);
		glm::vec3 upVector = glm::vec3(0.0f, -1.0f, 0.0f);
		shadowCamera.setViewDirection(lights[0].position, direction, upVector);
		this->shadowUbo.lightTransforms[0] = projection * shadowCamera.getViewMatrix();

		direction = glm::vec3(-1.0f, 0.0f, 0.0f);
		upVector = glm::vec3(0.0f, -1.0f, 0.0f);
		shadowCamera.setViewDirection(lights[0].position, direction, upVector);
		this->shadowUbo.lightTransforms[1] = projection * shadowCamera.getViewMatrix();

		direction = glm::vec3(0.0f, 1.0f, 0.0f);
		upVector = glm::vec3(0.0f, 0.0f, 1.0f);
		shadowCamera.setViewDirection(lights[0].position, direction, upVector);
		this->shadowUbo.lightTransforms[2] = projection * shadowCamera.getViewMatrix();

		direction = glm::vec3(0.0f, -1.0f, 0.0f);
		upVector = glm::vec3(0.0f, 0.0f, -1.0f);
		shadowCamera.setViewDirection(lights[0].position, direction, upVector);
		this->shadowUbo.lightTransforms[3] = projection * shadowCamera.getViewMatrix();

		direction = glm::vec3(0.0f, 0.0f, 1.0f);
		upVector = glm::vec3(0.0f, -1.0f, 0.0f);
		shadowCamera.setViewDirection(lights[0].position, direction, upVector);
		this->shadowUbo.lightTransforms[4] = projection * shadowCamera.getViewMatrix();

		direction = glm::vec3(0.0f, 0.0f, -1.0f);
		upVector = glm::vec3(0.0f, -1.0f, 0.0f);
		shadowCamera.setViewDirection(lights[0].position, direction, upVector);
		this->shadowUbo.lightTransforms[5] = projection * shadowCamera.getViewMatrix();
	}

	void App::updateCamera(uint32_t width, uint32_t height) {
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

		this->forwardUbo.transforms = projection * view;
		this->deferredUbo.originNumLights = glm::vec4(position, static_cast<float>(this->numLight));

		/* float phi = glm::radians(45.0f);
		float theta = glm::radians(45.0f);

		float sunX = glm::sin(theta) * glm::cos(phi);
		float sunY = glm::sin(theta) * glm::sin(phi);
		float sunZ = glm::cos(theta); */
	}

	void App::recreateSubRendererAndSubsystem() {
		uint32_t width = this->renderer->getSwapChain()->width();
		uint32_t height = this->renderer->getSwapChain()->height();
		uint32_t imageCount = static_cast<uint32_t>(this->renderer->getSwapChain()->imageCount());

		this->updateCamera(width, height);

		this->forwardSubPartRenderer = new ForwardSubPartRenderer(this->device, imageCount, width, height);
		this->deferredSubPartRenderer = new DeferredSubPartRenderer(this->device, this->renderer->getSwapChain()->getswapChainImages(), 
			this->renderer->getSwapChain()->getSwapChainImageFormat(), imageCount, width, height);
		this->shadowSubPartRenderer = new ShadowSubPartRenderer(this->device, SHADOW_RESOLUTION, SHADOW_RESOLUTION, this->numLight * 6);

		this->finalSubRenderer = FinalSubRenderer::Builder(this->device, width, height)
			.addSubPass(this->forwardSubPartRenderer->getAttachments(), this->forwardSubPartRenderer->getAttachmentDescs(),
				this->forwardSubPartRenderer->getOutputAttachmentRefs(), this->forwardSubPartRenderer->getDepthAttachmentRef())
			.addSubPass(this->deferredSubPartRenderer->getAttachments(), this->deferredSubPartRenderer->getAttachmentDescs(),
				this->deferredSubPartRenderer->getOutputAttachmentRefs(), this->deferredSubPartRenderer->getDepthAttachmentRef(),
				this->deferredSubPartRenderer->getInputAttachmentRefs())
			.addResolveAttachmentRef(this->deferredSubPartRenderer->getResolveAttachmentRef())
			.build();

		this->shadowSubRenderer = ShadowSubRenderer::Builder(this->device, SHADOW_RESOLUTION, SHADOW_RESOLUTION, this->numLight * 6)
			.addSubPass(this->shadowSubPartRenderer->getAttachments(), this->shadowSubPartRenderer->getAttachmentDescs(),
				{}, this->shadowSubPartRenderer->getDepthAttachmentRef())
			.build();

		VkDescriptorBufferInfo shadowModelInfos[2] = {
			this->transformationModel->getTransformationInfo(),
			this->pointLightModel->getLightInfo()
		};

		VkDescriptorBufferInfo forwardModelInfos[2] = {
			this->transformationModel->getTransformationInfo(),
			this->materialModel->getMaterialInfo()
		};

		std::vector<VkDescriptorImageInfo> deferredAttachmentInfos[5] = {
			this->forwardSubPartRenderer->getPositionInfoResources(),
			this->forwardSubPartRenderer->getNormalInfoResources(),
			this->forwardSubPartRenderer->getColorInfoResources(),
			this->forwardSubPartRenderer->getMaterialInfoResources()
		};

		VkDescriptorBufferInfo deferredModelInfo[1] {
			this->pointLightModel->getLightInfo()
		};

		std::vector<VkDescriptorImageInfo> deferredRenderTextureInfo[1] {
			this->shadowSubPartRenderer->getDepthInfoResources()
		};

		VkDescriptorImageInfo texturesInfo[1] {
			this->colorTexture->getDescriptorInfo()
		};
		
		this->shadowUniform = new ShadowUniform(this->device);
		this->forwardUniform = new ForwardUniform(this->device);
		this->deferredUniform = new DeferredUniform(this->device);

		std::vector<VkDescriptorBufferInfo> forwardUniformInfo[1] = {
			this->forwardUniform->getBuffersInfo()
		};

		std::vector<VkDescriptorBufferInfo> deferredUniformInfo[2] = {
			this->deferredUniform->getBuffersInfo(),
			this->shadowUniform->getBuffersInfo()
		};
		
		this->shadowDescSet = new ShadowDescSet(this->device, this->renderer->getDescriptorPool(), this->shadowUniform->getBuffersInfo(), shadowModelInfos);
		this->forwardDescSet = new ForwardDescSet(this->device, this->renderer->getDescriptorPool(), forwardUniformInfo, forwardModelInfos, texturesInfo);
		this->attachmentDeferredDescSet = new AttachmentDeferredDescSet(this->device, this->renderer->getDescriptorPool(), deferredAttachmentInfos, imageCount);
		this->modelDeferredDescSet = new ModelDeferredDescSet(this->device, this->renderer->getDescriptorPool(), deferredUniformInfo, 
			deferredModelInfo, deferredRenderTextureInfo);

		std::vector<NugieVulkan::DescriptorSetLayout*> deferredDescSetLayouts;
		deferredDescSetLayouts.emplace_back(this->attachmentDeferredDescSet->getDescSetLayout());
		deferredDescSetLayouts.emplace_back(this->modelDeferredDescSet->getDescSetLayout());

		this->shadowPassRenderer = new ShadowPassRenderSystem(this->device, this->shadowDescSet->getDescSetLayout(), this->shadowSubRenderer->getRenderPass());
		this->forwardPassRenderer = new ForwardPassRenderSystem(this->device, this->forwardDescSet->getDescSetLayout(), this->finalSubRenderer->getRenderPass());
		this->deferredPasRenderer = new DeferredPassRenderSystem(this->device, deferredDescSetLayouts, this->finalSubRenderer->getRenderPass());
	}
}