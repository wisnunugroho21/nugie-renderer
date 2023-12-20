#include "terrain_app.hpp"

#include "../renderer_sub/shadow_sub_renderer.hpp"
#include "../utils/load_terrain/load_terrain.hpp"

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

#include "../../../libraries/imgui/imgui.h"
#include "../../../libraries/imgui/imgui_impl_glfw.h"
#include "../../../libraries/imgui/imgui_impl_vulkan.h"

namespace NugieApp {
	TerrainApp::TerrainApp() {
		this->window = new NugieVulkan::Window(WIDTH, HEIGHT, APP_TITLE);
		this->device = new NugieVulkan::Device(this->window);
		this->renderer = new Renderer(this->window, this->device);

		this->camera = new Camera();
		this->mouseController = new MouseController();
		this->keyboardController = new KeyboardController();

		this->loadObjects();
		this->init();
	}

	TerrainApp::~TerrainApp() {
		ImGui_ImplVulkan_Shutdown();
		ImGui_ImplGlfw_Shutdown();
		ImGui::DestroyContext();

		if (this->terrainPassRenderer != nullptr) delete this->terrainPassRenderer;
		if (this->terrainSubPartRenderer != nullptr) delete this->terrainSubPartRenderer;

		if (this->finalSubRenderer != nullptr) delete this->finalSubRenderer;
		if (this->renderer != nullptr) delete this->renderer;

		if (this->terrainDescSet != nullptr) delete this->terrainDescSet;
		if (this->terrainUniform != nullptr) delete this->terrainUniform;

		if (this->indexModel != nullptr) delete this->indexModel;
		if (this->positionModel != nullptr) delete this->positionModel;

		if (this->device != nullptr) delete this->device;
		if (this->window != nullptr) delete this->window;

		if (this->mouseController != nullptr) delete this->mouseController;
		if (this->keyboardController != nullptr) delete this->keyboardController;
		if (this->camera != nullptr) delete this->camera;
	}

	void TerrainApp::singleThreadRun() {
		glm::vec3 cameraPosition, cameraDirection;
		bool isMousePressed = false, isKeyboardPressed = false;

		for (uint32_t i = 0; i < NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT; i++) {
			this->terrainUniform->writeGlobalData(i, this->forwardUbo);
		}

		std::vector<NugieVulkan::Buffer*> terrainBuffers;
		terrainBuffers.emplace_back(this->positionModel->getBuffer());

		ImGuiIO& io = ImGui::GetIO(); (void)io;
		auto oldTime = std::chrono::high_resolution_clock::now();

		bool hasTransfer = true;

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

			if ((isMousePressed || isKeyboardPressed) && !io.WantCaptureKeyboard && !io.WantCaptureMouse) {
				this->camera->setViewDirection(cameraPosition, cameraDirection);
				this->forwardUbo.cameraTransforms = this->camera->getProjectionMatrix() * this->camera->getViewMatrix();
				
				this->cameraUpdateCount = 0u;
			}

			if (this->renderer->acquireFrame()) {
				ImGui_ImplVulkan_NewFrame();
				ImGui_ImplGlfw_NewFrame();
				ImGui::NewFrame();

				ImGui::SetNextWindowPos(ImVec2(0.0f, 0.0f));
				ImGui::Begin("Peformace Overlay");

				ImGui::Text("%.3f ms/frame (%.1f FPS)", 1000.0f / io.Framerate, io.Framerate);
				ImGui::End();

				ImGui::Render();

				uint32_t frameIndex = this->renderer->getFrameIndex();
				uint32_t imageIndex = this->renderer->getImageIndex();

				if (this->cameraUpdateCount < NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT) {
					this->terrainUniform->writeGlobalData(frameIndex, this->forwardUbo);
					this->cameraUpdateCount++;
				}

				auto commandBuffer = this->renderer->beginRenderCommand();

				this->finalSubRenderer->beginRenderPass(commandBuffer, imageIndex);

				this->terrainPassRenderer->render(commandBuffer, this->terrainDescSet->getDescriptorSets(frameIndex), terrainBuffers, this->positionModel->size());
				ImGui_ImplVulkan_RenderDrawData(ImGui::GetDrawData(), commandBuffer->getCommandBuffer());

				this->finalSubRenderer->endRenderPass(commandBuffer);

				this->renderer->endRenderCommand(commandBuffer);
				this->renderer->submitRenderCommand(commandBuffer, hasTransfer);

				if (!this->renderer->presentFrame()) {
					this->resize();
					this->randomSeed = 0;

					continue;
				}				

				if (frameIndex + 1 == NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT) {
					this->randomSeed++;
				}				

				if (hasTransfer) {
					hasTransfer = false;
				}	
			}
		}

		vkDeviceWaitIdle(this->device->getLogicalDevice());
	}

	void TerrainApp::loadObjects() {
		std::vector<Position> positions;

		// ----------------------------------------------------------------------------

		LoadedTerrain loadedTerrain = loadTerrain("assets/terrain/heightmap.save");

		for (auto &&position : loadedTerrain.positions) {
			positions.emplace_back(position);
		}

		// ----------------------------------------------------------------------------

		auto commandBuffer = this->renderer->beginTransferCommand();

		this->positionModel = new VertexBufferObject<Position>(this->device);
		this->positionModel->replace(commandBuffer, positions);

		this->renderer->endTransferCommand(commandBuffer);
		this->renderer->submitTransferCommand(commandBuffer);
	}

	void TerrainApp::initCamera(uint32_t width, uint32_t height) {
		glm::vec3 position = glm::vec3(0.0f, 00.0f, -100.0f);
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

	void TerrainApp::init() {
		uint32_t width = this->renderer->getSwapChain()->getWidth();
		uint32_t height = this->renderer->getSwapChain()->getHeight();
		uint32_t imageCount = static_cast<uint32_t>(this->renderer->getSwapChain()->getImageCount());

		this->initCamera(width, height);

		this->terrainSubPartRenderer = new TerrainSubPartRenderer(this->device, this->renderer->getSwapChain()->getswapChainImages(), 
			this->renderer->getSwapChain()->getSwapChainImageFormat(), imageCount, width, height);

		this->finalSubRenderer = SubRenderer::Builder(this->device, width, height)
			.addSubPass(this->terrainSubPartRenderer->getAttachments(), this->terrainSubPartRenderer->getAttachmentDescs(),
				this->terrainSubPartRenderer->getOutputAttachmentRefs(), this->terrainSubPartRenderer->getDepthAttachmentRef())
			.addResolveAttachmentRef(this->terrainSubPartRenderer->getResolveAttachmentRef())
			.build();
		
		this->terrainUniform = new UniformBufferObject<ForwardUbo>(this->device);

		std::vector<VkDescriptorBufferInfo> terrainUniformInfo[1] = {
			this->terrainUniform->getInfo()
		};

		this->terrainDescSet = new TerrainDescSet(this->device, this->renderer->getDescriptorPool(), terrainUniformInfo);
		this->terrainPassRenderer = new TerrainPassRenderSystem(this->device, this->terrainDescSet->getDescSetLayout(), this->finalSubRenderer->getRenderPass());

		ImGui::CreateContext();
		ImGui_ImplGlfw_InitForVulkan(this->window->getWindow(), true);

		ImGui_ImplVulkan_InitInfo imguiVulkanInfo{};
		imguiVulkanInfo.Instance = this->device->getInstance();
		imguiVulkanInfo.PhysicalDevice = this->device->getPhysicalDevice();
		imguiVulkanInfo.Device = this->device->getLogicalDevice();
		imguiVulkanInfo.QueueFamily = this->device->getFamilyIndices().graphicsFamily;
		imguiVulkanInfo.Queue = this->device->getGraphicsQueue();
		imguiVulkanInfo.DescriptorPool = this->renderer->getDescriptorPool()->getDescriptorPool();
		imguiVulkanInfo.Subpass = 0u;
		imguiVulkanInfo.ImageCount = this->renderer->getSwapChain()->getImageCount();
		imguiVulkanInfo.MinImageCount = this->renderer->getSwapChain()->getImageCount();
		imguiVulkanInfo.MSAASamples = this->device->getMSAASamples();
		ImGui_ImplVulkan_Init(&imguiVulkanInfo, this->finalSubRenderer->getRenderPass()->getRenderPass());

		ImGui_ImplVulkan_CreateFontsTexture();
	}

	void TerrainApp::resize() {
		uint32_t width = this->renderer->getSwapChain()->getWidth();
		uint32_t height = this->renderer->getSwapChain()->getHeight();

		this->terrainSubPartRenderer->recreateResources(this->renderer->getSwapChain()->getswapChainImages(), width, height);

		std::vector<std::vector<VkImageView>> finalSubImageViews;

		auto terrainAttachments = this->terrainSubPartRenderer->getAttachments();

		for (size_t i = 0; i < terrainAttachments[0].size(); i++) {
			std::vector<VkImageView> imageViews;

			for (size_t j = 0; j < terrainAttachments.size(); j++) {
				imageViews.emplace_back(terrainAttachments[j][i]);
			}

			finalSubImageViews.emplace_back(imageViews);
		}

		this->finalSubRenderer->recreateResources(finalSubImageViews, width, height);

		float aspectRatio = static_cast<float>(width) / static_cast<float>(height);
		this->camera->setAspect(aspectRatio);

		this->forwardUbo.cameraTransforms = this->camera->getProjectionMatrix() * this->camera->getViewMatrix();
		this->cameraUpdateCount = 0u;
	}
}