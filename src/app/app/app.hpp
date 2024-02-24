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
#define SHADOW_RESOLUTION 1024

namespace NugieApp {
	class App
	{
		public:
			App();
			~App();

			void recordCommand();

			void run();
			void renderLoop();

			void singleThreadRun();

		private:
			void loadObjects();
			void initCamera(uint32_t width, uint32_t height);
			
			void init();
			void resize();

			NugieVulkan::Window* window;
			NugieVulkan::Device* device;

			Camera* camera;
			KeyboardController* keyboardController;
			MouseController* mouseController;

			Renderer* renderer;
			
			ComputeRenderSystem* screenRayGenerationRenderer;
			ComputeRenderSystem* rayIntersectionRenderer;
			ComputeRenderSystem* rayClosestHitRenderer;

			ArrayBuffer<Vertex>* vertexBuffer;
			ArrayBuffer<Material>* materialBuffer;
			ArrayBuffer<Transformation>* transformationBuffer;

			ArrayBuffer<Object>* objectBuffer;
			ArrayBuffer<BvhNode>* objectBvhNodeBuffer;
			ArrayBuffer<Primitive>* primitiveBuffer;
			ArrayBuffer<BvhNode>* primitiveBvhNodeBuffer;

			ObjectBuffer<RayGenData>* rayGenBuffer;
			ManyArrayBuffer<Ray>* rayBuffers;
			ManyArrayBuffer<HitRecord>* hitRecordBuffers;
			std::vector<NugieVulkan::Image*> resultImages;
			
			DescriptorSet* screenRayGenerationDescSet;
			DescriptorSet* rayIntersectionDescSet;
			DescriptorSet* rayClosestHitDescSet;

			uint32_t randomSeed = 0u, cameraUpdateCount = 0u, frameCount = 0;
			bool isRendering = true;

			RayGenData rayGenData;

			std::vector<NugieApp::Texture*> colorTextures;
	};
}