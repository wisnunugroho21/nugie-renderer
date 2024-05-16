#pragma once

#include "../../vulkan/window/window.hpp"
#include "../../vulkan/device/device.hpp"
#include "../../vulkan/buffer/buffer.hpp"
#include "../camera/camera.hpp"
#include "../controller/keyboard/keyboard_controller.hpp"
#include "../controller/mouse/mouse_controller.hpp"
#include "../data/buffer/array_buffer.hpp"
#include "../data/buffer/object_buffer.hpp"
#include "../data/buffer/many_array_buffer.hpp"
#include "../data/descSet/descriptor_set.hpp"
#include "../data/texture/texture.hpp"
#include "../renderer/renderer.hpp"
#include "../renderer_sub/sub_renderer.hpp"
#include "../renderer_system/compute_render_system.hpp"
#include "../utils/transform/transform.hpp"

#include <memory>
#include <vector>

#define APP_TITLE "Nugie Renderer"

#define WIDTH 800
#define HEIGHT 800
#define SHADOW_RESOLUTION 2048

namespace NugieApp {
	class App
	{
		public:
			App();
			~App();

			void recordCommand();

			void run();
			void renderLoop();

		private:
			void loadObjects();
			void initCamera(uint32_t width, uint32_t height);
			
			void init();
			void resize();

			NugieVulkan::Window* window = nullptr;
			NugieVulkan::Device* device = nullptr;

			Camera* camera = nullptr;
			Renderer* renderer = nullptr;

			ComputeRenderSystem* rayGenRenderer = nullptr;
			ComputeRenderSystem* rayIntersectRenderer = nullptr;
			ComputeRenderSystem* rayHitRenderer = nullptr;
			ComputeRenderSystem* samplingRenderer = nullptr;

			ArrayBuffer<Object>* objectBuffer = nullptr;
			ArrayBuffer<BvhNode>* objectBvhBuffer = nullptr;
			ArrayBuffer<Triangle>* triangleBuffer = nullptr;
			ArrayBuffer<BvhNode>* triangleBvhBuffer = nullptr;
			ArrayBuffer<Vertex>* vertexBuffer = nullptr;
			ArrayBuffer<Transformation>* transformBuffer = nullptr;

			ObjectBuffer<RayTraceUbo>* rayTraceUniformBuffer = nullptr;
			ManyArrayBuffer<Ray>* rayGenBuffer = nullptr;
			ManyArrayBuffer<Hit>* rayIntersectBuffer = nullptr;
			ManyArrayBuffer<Result>* rayHitBuffer = nullptr;

			std::vector<NugieVulkan::Image*> resultImages{};

			DescriptorSet* rayGenDescSet = nullptr;
			DescriptorSet* rayIntersectDescSet = nullptr;
			DescriptorSet* rayHitDescSet = nullptr;
			DescriptorSet* samplingDescSet = nullptr;

			uint32_t frameCount = 0u, randomSeed = 0u;
			bool isRendering = true;

			RayTraceUbo rayTraceUbo;
	};
}