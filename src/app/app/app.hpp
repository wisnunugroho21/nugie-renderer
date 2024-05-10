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
#include "../renderer/renderer.hpp"
#include "../renderer_sub/sub_renderer.hpp"
#include "../renderer_system/compute_render_system.hpp"
#include "../renderer_system/graphic_render_system.hpp"
#include "../utils/transform/transform.hpp"
#include "../utils/bvh/bvh.hpp"

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
			KeyboardController* keyboardController = nullptr;
			MouseController* mouseController = nullptr;

			Renderer* renderer = nullptr;
			SubRenderer* finalSubRenderer = nullptr;

			ComputeRenderSystem* indirectShadeRender = nullptr;
			ComputeRenderSystem* directShadeRender = nullptr;	
			ComputeRenderSystem* sunDirectShadeRender = nullptr;
			ComputeRenderSystem* integratorRender = nullptr;
			ComputeRenderSystem* intersectObjectRender = nullptr;
			ComputeRenderSystem* intersectLightRender = nullptr;	
			ComputeRenderSystem* lightShadeRender = nullptr;
			ComputeRenderSystem* missRender = nullptr;
			ComputeRenderSystem* indirectSamplerRender = nullptr;
			ComputeRenderSystem* directSamplerRender = nullptr;	
			ComputeRenderSystem* sunDirectSamplerRender = nullptr;

			GraphicRenderSystem* samplingRayRender = nullptr;

			std::vector<NugieVulkan::Image*> accumulateImages{};
			std::vector<NugieVulkan::Image*> indirectImages{};

			ObjectBuffer<RayTraceUbo>* globalUniformBuffer = nullptr;

			ArrayBuffer<Primitive>* primitiveBuffer = nullptr;
			ArrayBuffer<BvhNode>* primitiveBvhBuffer = nullptr;
			ArrayBuffer<Object>* objectBuffer = nullptr;
			ArrayBuffer<BvhNode>* objectBvhBuffer = nullptr;
			ArrayBuffer<TriangleLight>* lightBuffer = nullptr;
			ArrayBuffer<BvhNode>* lightBvhBuffer = nullptr;
			ArrayBuffer<RayTraceVertex>* rayTraceVertexBuffer = nullptr;

			ArrayBuffer<Material>* materialBuffer = nullptr;
			ArrayBuffer<Transformation>* transformationBuffer = nullptr;

			ManyArrayBuffer<RayData>* objectRayDataBuffer = nullptr;
			ManyArrayBuffer<RayData>* lightRayDataBuffer = nullptr;
			ManyArrayBuffer<HitRecord>* directObjectHitRecordBuffer = nullptr;
			ManyArrayBuffer<HitRecord>* directLightHitRecordBuffer = nullptr;
			ManyArrayBuffer<HitRecord>* indirectObjectHitRecordBuffer = nullptr;
			ManyArrayBuffer<HitRecord>* indirectLightHitRecordBuffer = nullptr;
			ManyArrayBuffer<DirectShadeRecord>* directShadeShadeBuffer = nullptr;
			ManyArrayBuffer<DirectShadeRecord>* sunDirectShadeShadeBuffer = nullptr;
			ManyArrayBuffer<IndirectShadeRecord>* indirectShadeShadeBuffer = nullptr;
			ManyArrayBuffer<LightShadeRecord>* lightShadeBuffer = nullptr;
			ManyArrayBuffer<MissRecord>* missBuffer = nullptr;
			ManyArrayBuffer<IndirectSamplerData>* indirectSamplerBuffer = nullptr;
			ManyArrayBuffer<RenderResult>* indirectDataBuffer = nullptr;
			ManyArrayBuffer<DirectData>* directDataBuffer = nullptr;

			ArrayBuffer<uint32_t>* quadIndexBuffer = nullptr;
			ArrayBuffer<Vertex>* quadVertexBuffer = nullptr;

			DescriptorSet* indirectShadeDescSet = nullptr;
			DescriptorSet* directShadeDescSet = nullptr;
			DescriptorSet* sunDirectShadeDescSet = nullptr;
			DescriptorSet* integratorDescSet = nullptr;
			DescriptorSet* directIntersectObjectDescSet = nullptr;
			DescriptorSet* directIntersectLightDescSet = nullptr;
			DescriptorSet* indirectIntersectObjectDescSet = nullptr;
			DescriptorSet* indirectIntersectLightDescSet = nullptr;
			DescriptorSet* lightShadeDescSet = nullptr;
			DescriptorSet* missDescSet = nullptr;
			DescriptorSet* indirectSamplerDescSet = nullptr;
			DescriptorSet* directSamplerDescSet = nullptr;
			DescriptorSet* sunDirectSamplerDescSet = nullptr;
			DescriptorSet* samplingDescSet = nullptr;

			uint32_t randomSeed = 0, numLights = 0, frameCount = 0, cameraUpdateCount = 0u;
			bool isRendering = true, isCameraMoved = false;
			float frameTime = 0;
			
			RayTraceUbo globalUbo;
	};
}