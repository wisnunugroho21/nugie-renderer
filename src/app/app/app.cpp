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

namespace NugieApp {
	App::App() {
		this->window = new NugieVulkan::Window(WIDTH, HEIGHT, APP_TITLE);
		this->device = new NugieVulkan::Device(this->window);
		this->renderer = new HybridRenderer(this->window, this->device);

		this->loadObjects();
		// this->loadQuadModels();
		this->recreateSubRendererAndSubsystem();
	}

	App::~App() {
		if (this->forwardPassRenderer != nullptr) delete this->forwardPassRenderer;
		if (this->deferredPasRenderer != nullptr) delete this->deferredPasRenderer;

		if (this->forwardSubPartRenderer != nullptr) delete this->forwardSubPartRenderer;
		if (this->deferredSubPartRenderer != nullptr) delete this->deferredSubPartRenderer;

		if (this->rayTracingSubRenderer != nullptr) delete this->rayTracingSubRenderer;
		if (this->renderer != nullptr) delete this->renderer;

		if (this->forwardDescSet != nullptr) delete this->forwardDescSet;
		if (this->attachmentDeferredDescSet != nullptr) delete this->attachmentDeferredDescSet;
		if (this->modelDeferredDescSet != nullptr) delete this->modelDeferredDescSet;
		if (this->rasterUniforms != nullptr) delete this->rasterUniforms;
		if (this->rayTracingUniform != nullptr) delete this->rayTracingUniform;

		if (this->indexModel != nullptr) delete this->indexModel;
		if (this->positionModel != nullptr) delete this->positionModel;
		if (this->normalModel != nullptr) delete this->normalModel;
		if (this->referenceModel != nullptr) delete this->referenceModel;
		if (this->materialModel != nullptr) delete this->materialModel;
		if (this->primitiveModel != nullptr) delete this->primitiveModel;
		if (this->objectModel != nullptr) delete this->objectModel;
		if (this->transformationModel != nullptr) delete this->transformationModel;
		if (this->triangleLightModel != nullptr) delete this->triangleLightModel;

		if (this->device != nullptr) delete this->device;
		if (this->window != nullptr) delete this->window;
	}

	void App::renderLoop() {
		std::vector<VkDeviceSize> vertexOffsets(3);
		vertexOffsets[0] = 0;
		vertexOffsets[1] = 0;
		vertexOffsets[2] = 0;

		std::vector<NugieVulkan::Buffer*> forwardBuffers;
		forwardBuffers.emplace_back(this->positionModel->getBuffer());
		forwardBuffers.emplace_back(this->normalModel->getBuffer());
		forwardBuffers.emplace_back(this->referenceModel->getBuffer());

		while (this->isRendering) {
			auto oldTime = std::chrono::high_resolution_clock::now();

			if (this->renderer->acquireFrame()) {
				uint32_t frameIndex = this->renderer->getFrameIndex();
				uint32_t imageIndex = this->renderer->getImageIndex();

				std::vector<VkDescriptorSet> descriptorSets;
				descriptorSets.emplace_back(this->attachmentDeferredDescSet->getDescriptorSets(imageIndex));
				descriptorSets.emplace_back(this->modelDeferredDescSet->getDescriptorSets(frameIndex));

				auto commandBuffer = this->renderer->beginCommand();

				this->rayTracingSubRenderer->beginRenderPass(commandBuffer, imageIndex);

				this->forwardPassRenderer->render(commandBuffer, this->forwardDescSet->getDescriptorSets(frameIndex), forwardBuffers, this->indexModel->getBuffer(), this->indexModel->getIndexCount(), vertexOffsets);
				this->rayTracingSubRenderer->nextSubpass(commandBuffer, VK_SUBPASS_CONTENTS_INLINE);
				this->deferredPasRenderer->render(commandBuffer, descriptorSets, this->randomSeed);

				this->rayTracingSubRenderer->endRenderPass(commandBuffer);

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

		this->rasterUniforms->writeGlobalData(0, this->rasterUbo);
		this->rayTracingUniform->writeGlobalData(0, this->rayTraceUbo);

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
		this->primitiveModel = new PrimitiveModel(this->device);

		std::vector<glm::vec4> positions;
		std::vector<glm::vec4> normals;
		std::vector<glm::uvec2> references;
		std::vector<uint32_t> indices;

		std::vector<Object> objects;
		std::vector<TransformComponent> transforms;
		std::vector<BoundBox*> boundBoxes;

		std::vector<TriangleLight> lights;

		// ----------------------------------------------------------------------------

		// kanan
		positions.emplace_back(glm::vec4{ 555.0f, 0.0f, 0.0f, 1.0f });
		positions.emplace_back(glm::vec4{ 555.0f, 555.0f, 0.0f, 1.0f });
		positions.emplace_back(glm::vec4{ 555.0f, 555.0f, 555.0f, 1.0f });
		positions.emplace_back(glm::vec4{ 555.0f, 0.0f, 555.0f, 1.0f });

		normals.emplace_back(glm::vec4{ -1.0f, 0.0f, 0.0f, 0.0f });
		normals.emplace_back(glm::vec4{ -1.0f, 0.0f, 0.0f, 0.0f });
		normals.emplace_back(glm::vec4{ -1.0f, 0.0f, 0.0f, 0.0f });
		normals.emplace_back(glm::vec4{ -1.0f, 0.0f, 0.0f, 0.0f });

		references.emplace_back(glm::uvec2{ 1, 0 });
		references.emplace_back(glm::uvec2{ 1, 0 });
		references.emplace_back(glm::uvec2{ 1, 0 });
		references.emplace_back(glm::uvec2{ 1, 0 });

		indices.emplace_back(0u);
		indices.emplace_back(1u);
		indices.emplace_back(2u);
		indices.emplace_back(2u);
		indices.emplace_back(3u);
		indices.emplace_back(0u);

		transforms.emplace_back(TransformComponent{ glm::vec3(0.0f), glm::vec3(1.0f), glm::vec3(0.0f) });
		uint32_t transformIndex = static_cast<uint32_t>(transforms.size() - 1);

		objects.emplace_back(Object{ this->primitiveModel->getBvhSize(), this->primitiveModel->getPrimitiveSize(), transformIndex });
		uint32_t objectIndex = static_cast<uint32_t>(objects.size() - 1);

		std::vector<Primitive> rightWallPrimitives;
		rightWallPrimitives.emplace_back(Primitive{ glm::uvec3(0u, 1u, 2u), 1u });
		rightWallPrimitives.emplace_back(Primitive{ glm::uvec3(2u, 3u, 0u), 1u });

		this->primitiveModel->addPrimitive(rightWallPrimitives, positions);

		boundBoxes.emplace_back(new ObjectBoundBox{ static_cast<uint32_t>(boundBoxes.size() + 1), &objects[objectIndex], rightWallPrimitives, &transforms[transformIndex], positions });
		uint32_t boundBoxIndex = static_cast<uint32_t>(boundBoxes.size() - 1);

		transforms[transformIndex].objectMaximum = boundBoxes[boundBoxIndex]->getOriginalMax();
		transforms[transformIndex].objectMinimum = boundBoxes[boundBoxIndex]->getOriginalMin();

		// ----------------------------------------------------------------------------
		
		// kiri
		positions.emplace_back(glm::vec4{ 0.0f, 0.0f, 0.0f, 1.0f });
		positions.emplace_back(glm::vec4{ 0.0f, 555.0f, 0.0f, 1.0f });
		positions.emplace_back(glm::vec4{ 0.0f, 555.0f, 555.0f, 1.0f });
		positions.emplace_back(glm::vec4{ 0.0f, 0.0f, 555.0f, 1.0f });

		normals.emplace_back(glm::vec4{ 1.0f, 0.0f, 0.0f, 0.0f });
		normals.emplace_back(glm::vec4{ 1.0f, 0.0f, 0.0f, 0.0f });
		normals.emplace_back(glm::vec4{ 1.0f, 0.0f, 0.0f, 0.0f });
		normals.emplace_back(glm::vec4{ 1.0f, 0.0f, 0.0f, 0.0f });

		references.emplace_back(glm::uvec2{ 2, 0 });
		references.emplace_back(glm::uvec2{ 2, 0 });
		references.emplace_back(glm::uvec2{ 2, 0 });
		references.emplace_back(glm::uvec2{ 2, 0 });

		indices.emplace_back(4u);
		indices.emplace_back(5u);
		indices.emplace_back(6u);
		indices.emplace_back(6u);
		indices.emplace_back(7u);
		indices.emplace_back(4u);

		transforms.emplace_back(TransformComponent{ glm::vec3(0.0f), glm::vec3(1.0f), glm::vec3(0.0f) });
		transformIndex = static_cast<uint32_t>(transforms.size() - 1);

		objects.emplace_back(Object{ this->primitiveModel->getBvhSize(), this->primitiveModel->getPrimitiveSize(), transformIndex });
		objectIndex = static_cast<uint32_t>(objects.size() - 1);

		std::vector<Primitive> leftWallPrimitives;
		leftWallPrimitives.emplace_back(Primitive{ glm::uvec3(4u, 5u, 6u) });
		leftWallPrimitives.emplace_back(Primitive{ glm::uvec3(6u, 7u, 4u) });

		this->primitiveModel->addPrimitive(rightWallPrimitives, positions);

		boundBoxes.emplace_back(new ObjectBoundBox{ static_cast<uint32_t>(boundBoxes.size() + 1), &objects[objectIndex], leftWallPrimitives, &transforms[transformIndex], positions });
		boundBoxIndex = static_cast<uint32_t>(boundBoxes.size() - 1);

		transforms[transformIndex].objectMaximum = boundBoxes[boundBoxIndex]->getOriginalMax();
		transforms[transformIndex].objectMinimum = boundBoxes[boundBoxIndex]->getOriginalMin();

		// ----------------------------------------------------------------------------
		
		// bawah
		positions.emplace_back(glm::vec4{ 0.0f, 0.0f, 0.0f, 1.0f });
		positions.emplace_back(glm::vec4{ 555.0f, 0.0f, 0.0f, 1.0f });
		positions.emplace_back(glm::vec4{ 555.0f, 0.0f, 555.0f, 1.0f });
		positions.emplace_back(glm::vec4{ 0.0f, 0.0f, 555.0f, 1.0f });

		normals.emplace_back(glm::vec4{ 0.0f, 1.0f, 0.0f, 0.0f });
		normals.emplace_back(glm::vec4{ 0.0f, 1.0f, 0.0f, 0.0f });
		normals.emplace_back(glm::vec4{ 0.0f, 1.0f, 0.0f, 0.0f });
		normals.emplace_back(glm::vec4{ 0.0f, 1.0f, 0.0f, 0.0f });

		references.emplace_back(glm::uvec2{ 0, 0 });
		references.emplace_back(glm::uvec2{ 0, 0 });
		references.emplace_back(glm::uvec2{ 0, 0 });
		references.emplace_back(glm::uvec2{ 0, 0 });

		indices.emplace_back(8u);
		indices.emplace_back(9u);
		indices.emplace_back(10u);
		indices.emplace_back(10u);
		indices.emplace_back(11u);
		indices.emplace_back(8u);

		transforms.emplace_back(TransformComponent{ glm::vec3(0.0f), glm::vec3(1.0f), glm::vec3(0.0f) });
		transformIndex = static_cast<uint32_t>(transforms.size() - 1);

		objects.emplace_back(Object{ this->primitiveModel->getBvhSize(), this->primitiveModel->getPrimitiveSize(), transformIndex });
		objectIndex = static_cast<uint32_t>(objects.size() - 1);

		std::vector<Primitive> bottomWallPrimitives;
		bottomWallPrimitives.emplace_back(Primitive{ glm::uvec3(8u, 9u, 10u) });
		bottomWallPrimitives.emplace_back(Primitive{ glm::uvec3(10u, 11u, 8u) });

		this->primitiveModel->addPrimitive(rightWallPrimitives, positions);

		boundBoxes.emplace_back(new ObjectBoundBox{ static_cast<uint32_t>(boundBoxes.size() + 1), &objects[objectIndex], bottomWallPrimitives, &transforms[transformIndex], positions });
		boundBoxIndex = static_cast<uint32_t>(boundBoxes.size() - 1);

		transforms[transformIndex].objectMaximum = boundBoxes[boundBoxIndex]->getOriginalMax();
		transforms[transformIndex].objectMinimum = boundBoxes[boundBoxIndex]->getOriginalMin();

		// ----------------------------------------------------------------------------
		
		// atas
		positions.emplace_back(glm::vec4{ 0.0f, 555.0f, 0.0f, 1.0f });
		positions.emplace_back(glm::vec4{ 555.0f, 555.0f, 0.0f, 1.0f });
		positions.emplace_back(glm::vec4{ 555.0f, 555.0f, 555.0f, 1.0f });
		positions.emplace_back(glm::vec4{ 0.0f, 555.0f, 555.0f, 1.0f });

		normals.emplace_back(glm::vec4{ 0.0f, -1.0f, 0.0f, 0.0f });
		normals.emplace_back(glm::vec4{ 0.0f, -1.0f, 0.0f, 0.0f });
		normals.emplace_back(glm::vec4{ 0.0f, -1.0f, 0.0f, 0.0f });
		normals.emplace_back(glm::vec4{ 0.0f, -1.0f, 0.0f, 0.0f });

		references.emplace_back(glm::uvec2{ 0, 0 });
		references.emplace_back(glm::uvec2{ 0, 0 });
		references.emplace_back(glm::uvec2{ 0, 0 });
		references.emplace_back(glm::uvec2{ 0, 0 });

		indices.emplace_back(12u);
		indices.emplace_back(13u);
		indices.emplace_back(14u);
		indices.emplace_back(14u);
		indices.emplace_back(15u);
		indices.emplace_back(12u);

		transforms.emplace_back(TransformComponent{ glm::vec3(0.0f), glm::vec3(1.0f), glm::vec3(0.0f) });
		transformIndex = static_cast<uint32_t>(transforms.size() - 1);

		objects.emplace_back(Object{ this->primitiveModel->getBvhSize(), this->primitiveModel->getPrimitiveSize(), transformIndex });
		objectIndex = static_cast<uint32_t>(objects.size() - 1);

		std::vector<Primitive> topWallPrimitives;
		topWallPrimitives.emplace_back(Primitive{ glm::uvec3(12u, 13u, 14u) });
		topWallPrimitives.emplace_back(Primitive{ glm::uvec3(14u, 15u, 12u) });

		this->primitiveModel->addPrimitive(rightWallPrimitives, positions);

		boundBoxes.emplace_back(new ObjectBoundBox{ static_cast<uint32_t>(boundBoxes.size() + 1), &objects[objectIndex], topWallPrimitives, &transforms[transformIndex], positions });
		boundBoxIndex = static_cast<uint32_t>(boundBoxes.size() - 1);

		transforms[transformIndex].objectMaximum = boundBoxes[boundBoxIndex]->getOriginalMax();
		transforms[transformIndex].objectMinimum = boundBoxes[boundBoxIndex]->getOriginalMin();

		// ----------------------------------------------------------------------------
		
		// depan
		positions.emplace_back(glm::vec4{ 0.0f, 0.0f, 555.0f, 1.0f });
		positions.emplace_back(glm::vec4{ 0.0f, 555.0f, 555.0f, 1.0f });
		positions.emplace_back(glm::vec4{ 555.0f, 555.0f, 555.0f, 1.0f });
		positions.emplace_back(glm::vec4{ 555.0f, 0.0f, 555.0f, 1.0f });

		normals.emplace_back(glm::vec4{ 0.0f, 0.0f, -1.0f, 0.0f });
		normals.emplace_back(glm::vec4{ 0.0f, 0.0f, -1.0f, 0.0f });
		normals.emplace_back(glm::vec4{ 0.0f, 0.0f, -1.0f, 0.0f });
		normals.emplace_back(glm::vec4{ 0.0f, 0.0f, -1.0f, 0.0f });

		references.emplace_back(glm::uvec2{ 0, 0 });
		references.emplace_back(glm::uvec2{ 0, 0 });
		references.emplace_back(glm::uvec2{ 0, 0 });
		references.emplace_back(glm::uvec2{ 0, 0 });

		indices.emplace_back(16u);
		indices.emplace_back(17u);
		indices.emplace_back(18u);
		indices.emplace_back(18u);
		indices.emplace_back(19u);
		indices.emplace_back(16u);

		transforms.emplace_back(TransformComponent{ glm::vec3(0.0f), glm::vec3(1.0f), glm::vec3(0.0f) });
		transformIndex = static_cast<uint32_t>(transforms.size() - 1);

		objects.emplace_back(Object{ this->primitiveModel->getBvhSize(), this->primitiveModel->getPrimitiveSize(), transformIndex });
		objectIndex = static_cast<uint32_t>(objects.size() - 1);

		std::vector<Primitive> frontWallPrimitives;
		frontWallPrimitives.emplace_back(Primitive{ glm::uvec3(16u, 17u, 18u) });
		frontWallPrimitives.emplace_back(Primitive{ glm::uvec3(18u, 19u, 16u) });

		this->primitiveModel->addPrimitive(rightWallPrimitives, positions);

		boundBoxes.emplace_back(new ObjectBoundBox{ static_cast<uint32_t>(boundBoxes.size() + 1), &objects[objectIndex], frontWallPrimitives, &transforms[transformIndex], positions });
		boundBoxIndex = static_cast<uint32_t>(boundBoxes.size() - 1);

		transforms[transformIndex].objectMaximum = boundBoxes[boundBoxIndex]->getOriginalMax();
		transforms[transformIndex].objectMinimum = boundBoxes[boundBoxIndex]->getOriginalMin();

		// ----------------------------------------------------------------------------

		auto materials = std::vector<Material>();

		materials.emplace_back(Material{ glm::vec3{ 0.73f, 0.73f, 0.73f }, 0.0f, 0.0f, 0.0f });
		materials.emplace_back(Material{ glm::vec3{ 0.65f, 0.05f, 0.05f }, 0.0f, 0.0f, 0.0f });
		materials.emplace_back(Material{ glm::vec3{ 0.12f, 0.45f, 0.15f }, 0.0f, 0.0f, 0.0f });

		lights.emplace_back(TriangleLight{ glm::vec3{213.0f, 554.0f, 227.0f}, glm::vec3{343.0f, 554.0f, 227.0f}, glm::vec3{343.0f, 554.0f, 332.0f}, glm::vec3(100.0f) });
		lights.emplace_back(TriangleLight{ glm::vec3{343.0f, 554.0f, 332.0f}, glm::vec3{213.0f, 554.0f, 332.0f}, glm::vec3{213.0f, 554.0f, 227.0f}, glm::vec3(100.0f) });

		// ----------------------------------------------------------------------------

		auto commandBuffer = this->renderer->beginTransferCommand();

		this->positionModel = new PositionModel(this->device);
		this->positionModel->update(commandBuffer, positions);

		this->normalModel = new NormalModel(this->device);
		this->normalModel->update(commandBuffer, normals);

		this->indexModel = new IndexModel(this->device);
		this->indexModel->update(commandBuffer, indices);

		this->referenceModel = new ReferenceModel(this->device);
		this->referenceModel->update(commandBuffer, references);

		this->primitiveModel->updatePrimitiveBuffers(commandBuffer);
		this->primitiveModel->updateBvhBuffers(commandBuffer);

		this->objectModel = new ObjectModel(this->device);
		this->objectModel->updateObject(commandBuffer, objects);
		this->objectModel->updateBvh(commandBuffer, boundBoxes);

		this->materialModel = new MaterialModel(this->device);
		this->materialModel->update(commandBuffer, materials);

		this->transformationModel = new TransformationModel(this->device);
		this->transformationModel->update(commandBuffer, transforms);

		this->triangleLightModel = new TriangleLightModel(this->device);
		this->triangleLightModel->updateTriangleLight(commandBuffer, lights);
		this->triangleLightModel->updateBvh(commandBuffer, lights);

		this->renderer->endTransferCommand(commandBuffer);
		this->renderer->submitTransferCommand(commandBuffer);

		this->numLight = static_cast<uint32_t>(lights.size());
	}

	void App::loadQuadModels() {
		auto positions = std::vector<glm::vec4>();
		auto indices = std::vector<uint32_t>();

		glm::vec4 position1 { -1.0f, -1.0f, 0.0f, 1.0f };
		positions.emplace_back(position1);

		glm::vec4 position2 { 1.0f, -1.0f, 0.0f, 1.0f };
		positions.emplace_back(position2);

		glm::vec4 position3 { 1.0f, 1.0f, 0.0f, 1.0f };
		positions.emplace_back(position3);

		glm::vec4 position4 { -1.0f, 1.0f, 0.0f, 1.0f };
		positions.emplace_back(position4);

		indices = {
			0, 1, 2, 2, 3, 0
		};

		auto commandBuffer = this->renderer->beginTransferCommand();

		this->positionModel = new PositionModel(this->device);
		this->positionModel->update(commandBuffer, positions);

		this->indexModel = new IndexModel(this->device);
		this->indexModel->update(commandBuffer, indices);

		this->renderer->endTransferCommand(commandBuffer);
		this->renderer->submitTransferCommand(commandBuffer);
	}

	void App::updateCamera(uint32_t width, uint32_t height) {
		glm::vec3 position = glm::vec3(278.0f, 278.0f, -800.0f);
		glm::vec3 direction = glm::vec3(0.0f, 0.0f, 800.0f);
		glm::vec3 vup = glm::vec3(0.0f, 1.0f, 0.0f);

		float near = 0.1f;
		float far = 2000.0f;

		constexpr float theta = glm::radians(40.0f);
		float tanHalfFovy = glm::tan(theta / 2.0f);
		float aspectRatio = static_cast<float>(width) / static_cast<float>(height);

		glm::vec3 w = glm::normalize(direction);
		glm::vec3 u = glm::normalize(glm::cross(w, vup));
		glm::vec3 v = glm::cross(w, u);

		glm::mat4 view = glm::mat4{1.0f};
		view[0][0] = u.x;
    view[1][0] = u.y;
    view[2][0] = u.z;
    view[0][1] = v.x;
    view[1][1] = v.y;
    view[2][1] = v.z;
    view[0][2] = w.x;
    view[1][2] = w.y;
    view[2][2] = w.z;
    view[3][0] = -glm::dot(u, position);
    view[3][1] = -glm::dot(v, position);
    view[3][2] = -glm::dot(w, position);

		glm::mat4 projection = glm::mat4{0.0f};
		projection[0][0] = 1.f / (aspectRatio * tanHalfFovy);
    projection[1][1] = 1.f / (tanHalfFovy);
    projection[2][2] = far / (far - near);
    projection[2][3] = 1.f;
    projection[3][2] = -(far * near) / (far - near);

		this->rasterUbo.transforms = projection * view;

		this->rayTraceUbo.origin = position;
		this->rayTraceUbo.background = glm::vec3(0.0f);
		this->rayTraceUbo.numLights = this->numLight;
		this->rayTraceUbo.screenSize = glm::vec2(WIDTH, HEIGHT);

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

		this->forwardSubPartRenderer = new ForwardSubPartRenderer(this->device, this->renderer->getSwapChain()->getSwapChainImageFormat(), imageCount, width, height);
		this->deferredSubPartRenderer = new DeferredSubPartRenderer(this->device, this->renderer->getSwapChain()->getswapChainImages(), 
			this->renderer->getSwapChain()->getSwapChainImageFormat(), imageCount, width, height);

		this->rayTracingSubRenderer = RayTracingSubRenderer::Builder(this->device, width, height)
			.addSubPass(this->forwardSubPartRenderer->getAttachments(), this->forwardSubPartRenderer->getAttachmentDescs(),
				this->forwardSubPartRenderer->getOutputAttachmentRefs(), this->forwardSubPartRenderer->getDepthAttachmentRef())
			.addSubPass(this->deferredSubPartRenderer->getAttachments(), this->deferredSubPartRenderer->getAttachmentDescs(),
				this->deferredSubPartRenderer->getOutputAttachmentRefs(), this->deferredSubPartRenderer->getDepthAttachmentRef(),
				this->deferredSubPartRenderer->getInputAttachmentRefs())
			.addResolveAttachmentRef(this->deferredSubPartRenderer->getResolveAttachmentRef())
			.build();

		VkDescriptorBufferInfo forwardModelInfos[2] = {
			this->transformationModel->getTransformationInfo(),
			this->materialModel->getMaterialInfo()
		};

		std::vector<VkDescriptorImageInfo> deferredAttachmentInfos[4] = {
			this->forwardSubPartRenderer->getPositionInfoResources(),
			this->forwardSubPartRenderer->getNormalInfoResources(),
			this->forwardSubPartRenderer->getColorInfoResources(),
			this->forwardSubPartRenderer->getMaterialInfoResources()
		};

		VkDescriptorBufferInfo deferredModelInfo[9] {
			this->objectModel->getObjectInfo(), 
			this->objectModel->getBvhInfo(),
			this->primitiveModel->getPrimitiveInfo(), 
			this->primitiveModel->getBvhInfo(),
			this->positionModel->getPositionInfo(),
			this->triangleLightModel->getLightInfo(),
			this->triangleLightModel->getBvhInfo(),
			this->materialModel->getMaterialInfo(),
			this->transformationModel->getTransformationInfo()
		};
		
		this->rasterUniforms = new RasterUniform(this->device);
		this->rayTracingUniform = new RayTracingUniform(this->device);
		
		this->forwardDescSet = new ForwardDescSet(this->device, this->renderer->getDescriptorPool(), this->rasterUniforms->getBuffersInfo(), forwardModelInfos);
		this->attachmentDeferredDescSet = new AttachmentDeferredDescSet(this->device, this->renderer->getDescriptorPool(), deferredAttachmentInfos, imageCount);
		this->modelDeferredDescSet = new ModelDeferredDescSet(this->device, this->renderer->getDescriptorPool(), this->rayTracingUniform->getBuffersInfo(), deferredModelInfo);

		std::vector<NugieVulkan::DescriptorSetLayout*> deferredDescSetLayouts;
		deferredDescSetLayouts.emplace_back(this->attachmentDeferredDescSet->getDescSetLayout());
		deferredDescSetLayouts.emplace_back(this->modelDeferredDescSet->getDescSetLayout());

		this->forwardPassRenderer = new ForwardPassRenderSystem(this->device, this->forwardDescSet->getDescSetLayout(), this->rayTracingSubRenderer->getRenderPass());
		this->deferredPasRenderer = new DeferredPassRenderSystem(this->device, deferredDescSetLayouts, this->rayTracingSubRenderer->getRenderPass());
	}
}