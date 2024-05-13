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
		this->renderer = new Renderer(this->window, this->device);

		this->camera = new Camera(WIDTH, HEIGHT);

		this->loadObjects();
		this->init();
		this->recordCommand();
	}

	App::~App() {
		if (this->rayGenRenderer != nullptr) delete this->rayGenRenderer;
		if (this->samplingRenderer != nullptr) delete this->samplingRenderer;

		if (this->renderer != nullptr) delete this->renderer;

		if (this->rayGenDescSet != nullptr) delete this->rayGenDescSet;
		if (this->samplingDescSet != nullptr) delete this->samplingDescSet;

		if (this->vertexBuffer != nullptr) delete this->vertexBuffer;
		if (this->primitiveBuffer != nullptr) delete this->primitiveBuffer;

		if (this->rayGenBuffer != nullptr) delete this->rayGenBuffer;
		if (this->rayTraceUniformBuffer != nullptr) delete this->rayTraceUniformBuffer;

		for (auto &&resultImage : this->resultImages) {
			if (resultImage != nullptr) delete resultImage;
		}		

		if (this->device != nullptr) delete this->device;
		if (this->window != nullptr) delete this->window;
	}

	void App::recordCommand() {
		auto prepareCommandBuffer = this->renderer->beginRecordPrepareCommand();

		for (auto &&swapChainImage : this->renderer->getSwapChain()->getswapChainImages()) {
			swapChainImage->transitionImageLayout(prepareCommandBuffer, VK_IMAGE_LAYOUT_UNDEFINED, VK_IMAGE_LAYOUT_PRESENT_SRC_KHR,
				VK_PIPELINE_STAGE_TOP_OF_PIPE_BIT, VK_PIPELINE_STAGE_TOP_OF_PIPE_BIT, 0, 0);
		}

		for (auto &&resultImage : this->resultImages) {
			resultImage->transitionImageLayout(prepareCommandBuffer, VK_IMAGE_LAYOUT_UNDEFINED, VK_IMAGE_LAYOUT_GENERAL,
				VK_PIPELINE_STAGE_TOP_OF_PIPE_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, 0, 0);
		}

		prepareCommandBuffer->endCommand();

		uint32_t imageCount = this->renderer->getSwapChain()->getImageCount();
		uint32_t height = this->renderer->getSwapChain()->getHeight();
		uint32_t width = this->renderer->getSwapChain()->getWidth();

		for (uint32_t imageIndex = 0; imageIndex < imageCount; imageIndex++) {
			for (uint32_t frameIndex = 0; frameIndex < NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT; frameIndex++) {
				auto commandBuffer = this->renderer->beginRecordRenderCommand(frameIndex, imageIndex);
				auto swapChainImage = this->renderer->getSwapChain()->getswapChainImages()[imageIndex];

				this->rayGenRenderer->render(commandBuffer, { this->rayGenDescSet->getDescriptorSets(frameIndex) }, height * width / 64, 1, 1);

				this->rayGenBuffer->getBuffer(frameIndex)->transitionBuffer(commandBuffer, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, 
					VK_ACCESS_SHADER_WRITE_BIT, VK_ACCESS_SHADER_READ_BIT);

				this->samplingRenderer->render(commandBuffer, { this->samplingDescSet->getDescriptorSets(frameIndex) }, height / 8, width / 8, 1);

				this->resultImages[frameIndex]->transitionImageLayout(commandBuffer, VK_IMAGE_LAYOUT_GENERAL, VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL, 
					VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_TRANSFER_BIT, VK_ACCESS_SHADER_WRITE_BIT, VK_ACCESS_TRANSFER_READ_BIT);

				swapChainImage->transitionImageLayout(commandBuffer, VK_IMAGE_LAYOUT_PRESENT_SRC_KHR, VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL, 
					VK_PIPELINE_STAGE_TOP_OF_PIPE_BIT, VK_PIPELINE_STAGE_TRANSFER_BIT, 0, VK_ACCESS_TRANSFER_WRITE_BIT);

				this->resultImages[frameIndex]->copyImageToOther(commandBuffer, swapChainImage);

				this->resultImages[frameIndex]->transitionImageLayout(commandBuffer, VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL, VK_IMAGE_LAYOUT_GENERAL, 
					VK_PIPELINE_STAGE_TRANSFER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_TRANSFER_READ_BIT, VK_ACCESS_SHADER_WRITE_BIT);

				swapChainImage->transitionImageLayout(commandBuffer, VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL, VK_IMAGE_LAYOUT_PRESENT_SRC_KHR, 
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

				this->rayTraceUniformBuffer->writeGlobalData(frameIndex, this->rayTraceUbo);
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

		std::thread renderThread(&App::renderLoop, std::ref(*this));

		auto oldTime = std::chrono::high_resolution_clock::now();
		auto oldFpsTime = std::chrono::high_resolution_clock::now();

		while (!this->window->shouldClose()) {
			this->window->pollEvents();

			auto newTime = std::chrono::high_resolution_clock::now();
			float deltaTime = std::chrono::duration<float, std::chrono::seconds::period>(newTime - oldTime).count();
			oldTime = newTime;

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
		std::vector<Vertex> vertices;
		std::vector<Primitive> primitives;

		// ----------------------------------------------------------------------------

		vertices.emplace_back(Vertex{ glm::vec3{ -1.0f, -1.0f, 0.0f } });
		vertices.emplace_back(Vertex{ glm::vec3{ 1.0f, -1.0f, 0.0f } });
		vertices.emplace_back(Vertex{ glm::vec3{ 0.5f, 1.0f, 0.0f } });

		primitives.emplace_back(Primitive{ glm::uvec3{ 0, 1, 2 } });

		// ----------------------------------------------------------------------------		

		auto commandBuffer = this->renderer->beginRecordTransferCommand();

		this->vertexBuffer = new ArrayBuffer<Vertex>(this->device, VK_BUFFER_USAGE_STORAGE_BUFFER_BIT, static_cast<uint32_t>(vertices.size()));
		this->vertexBuffer->replace(commandBuffer, vertices);

		this->primitiveBuffer = new ArrayBuffer<Primitive>(this->device, VK_BUFFER_USAGE_STORAGE_BUFFER_BIT, static_cast<uint32_t>(primitives.size()));
		this->primitiveBuffer->replace(commandBuffer, primitives);

		commandBuffer->endCommand();
		this->renderer->submitTransferCommand();
	}

	void App::initCamera(uint32_t width, uint32_t height) {
		RayTraceUbo ubo{};

		this->camera->setViewDirection(glm::vec3{278.0f, 278.0f, -800.0f}, glm::vec3{0.0f, 0.0f, 1.0f}, 40.0f);
		CameraRay cameraRay = this->camera->getCameraRay();
		
		this->rayTraceUbo.origin = cameraRay.origin;
		this->rayTraceUbo.horizontal = cameraRay.horizontal;
		this->rayTraceUbo.vertical = cameraRay.vertical;
		this->rayTraceUbo.lowerLeftCorner = cameraRay.lowerLeftCorner;
		this->rayTraceUbo.imgSize = glm::uvec2{width, height};
	}

	void App::init() {
		uint32_t width = this->renderer->getSwapChain()->getWidth();
		uint32_t height = this->renderer->getSwapChain()->getHeight();
		uint32_t imageCount = static_cast<uint32_t>(this->renderer->getSwapChain()->getImageCount());
		VkSampleCountFlagBits msaaSample = this->device->getMSAASamples();

		this->initCamera(width, height);

		this->rayTraceUniformBuffer = new ObjectBuffer<RayTraceUbo>(this->device, VK_BUFFER_USAGE_UNIFORM_BUFFER_BIT);
		this->rayGenBuffer = new ManyArrayBuffer<Ray>(this->device, VK_BUFFER_USAGE_STORAGE_BUFFER_BIT, width * height);

		std::vector<VkDescriptorImageInfo> resultImageInfos { NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT };
		this->resultImages.resize(NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT);

		for (uint32_t i = 0; i < NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT; i++) {
			this->resultImages[i] = new NugieVulkan::Image(this->device, width, height, 1, VK_SAMPLE_COUNT_1_BIT, VK_FORMAT_R16G16B16A16_SFLOAT,
        VK_IMAGE_TILING_OPTIMAL, VK_IMAGE_USAGE_STORAGE_BIT | VK_IMAGE_USAGE_TRANSFER_SRC_BIT, VMA_MEMORY_USAGE_AUTO, VMA_ALLOCATION_CREATE_DEDICATED_MEMORY_BIT, 
        VK_IMAGE_ASPECT_COLOR_BIT);

			resultImageInfos[i] = this->resultImages[i]->getDescriptorInfo(VK_IMAGE_LAYOUT_GENERAL);
		}

		this->rayGenDescSet = DescriptorSet::Builder(this->device, this->renderer->getDescriptorPool(), NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT)
			.addBuffer(0, VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->rayTraceUniformBuffer->getInfo())
			.addBuffer(1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->rayGenBuffer->getInfo())
			.build();
		
		this->samplingDescSet = DescriptorSet::Builder(this->device, this->renderer->getDescriptorPool(), NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT)
			.addBuffer(0, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_COMPUTE_BIT, this->rayGenBuffer->getInfo())
			.addImage(1, VK_DESCRIPTOR_TYPE_STORAGE_IMAGE, VK_SHADER_STAGE_COMPUTE_BIT, resultImageInfos)
			.build();
		
		this->rayGenRenderer = new ComputeRenderSystem(this->device, { this->rayGenDescSet->getDescSetLayout() }, "shader/ray_gen.comp.spv");
		this->samplingRenderer = new ComputeRenderSystem(this->device, { this->samplingDescSet->getDescSetLayout() }, "shader/sampling.comp.spv");

		this->rayGenRenderer->initialize();
		this->samplingRenderer->initialize();
	}

	void App::resize() {
		uint32_t width = this->renderer->getSwapChain()->getWidth();
		uint32_t height = this->renderer->getSwapChain()->getHeight();
		uint32_t imageCount = static_cast<uint32_t>(this->renderer->getSwapChain()->getImageCount());
		VkSampleCountFlagBits msaaSample = this->device->getMSAASamples();

		this->renderer->resetCommandPool();
		this->recordCommand();
	}
}