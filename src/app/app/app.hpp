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
#include "../data/buffer/staging_buffer.hpp"
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

			ComputeRenderSystem* rayIntersectRenderer = nullptr;
			ComputeRenderSystem* indirectRayGenRenderer = nullptr;
			ComputeRenderSystem* indirectRayHitRenderer = nullptr;
			ComputeRenderSystem* lightRayHitRenderer = nullptr;
			ComputeRenderSystem* missRayRenderer = nullptr;
			ComputeRenderSystem* directRayGenRenderer = nullptr;
			ComputeRenderSystem* directRayHitRenderer = nullptr;
			ComputeRenderSystem* integratorRenderer = nullptr;
			ComputeRenderSystem* samplingRenderer = nullptr;

			ArrayBuffer<Object>* objectBuffer = nullptr;
			ArrayBuffer<BvhNode>* objectBvhBuffer = nullptr;
			ArrayBuffer<Triangle>* triangleBuffer = nullptr;
			ArrayBuffer<Triangle>* triangleLightBuffer = nullptr;
			ArrayBuffer<BvhNode>* geometryBvhBuffer = nullptr;
			ArrayBuffer<Vertex>* vertexBuffer = nullptr;
			ArrayBuffer<Transformation>* transformBuffer = nullptr;
			ArrayBuffer<Material>* materialBuffer = nullptr;

			ObjectBuffer<RayTraceUbo>* rayTraceUniformBuffer = nullptr;

			ManyArrayBuffer<Ray>* currentRayBuffer = nullptr;
			ManyArrayBuffer<uint32_t>* rayBounceBuffer = nullptr;
			ManyArrayBuffer<bool>* isHitBuffer = nullptr;
			ManyArrayBuffer<float>* hitLengthBuffer = nullptr;
			ManyArrayBuffer<uint32_t>* hitIndexBuffer = nullptr;
			ManyArrayBuffer<uint32_t>* hitTypeIndexBuffer = nullptr;
			ManyArrayBuffer<bool>* indirectIsScatteredBuffer = nullptr;
			ManyArrayBuffer<glm::vec4>* indirectRadianceBuffer = nullptr;
			ManyArrayBuffer<float>* indirectPdfBuffer = nullptr;
			ManyArrayBuffer<Ray>* scatteredRayBuffer = nullptr;
			ManyArrayBuffer<glm::vec4>* indirectNormalBuffer = nullptr;
			ManyArrayBuffer<glm::vec4>* indirectHitPositionBuffer = nullptr;
			ManyArrayBuffer<uint32_t>* indirectMaterialIndexBuffer = nullptr;
			ManyArrayBuffer<bool>* directIsIlluminateBuffer = nullptr;
			ManyArrayBuffer<glm::vec4>* directRadianceBuffer = nullptr;
			ManyArrayBuffer<float>* directPdfBuffer = nullptr;
			ManyArrayBuffer<bool>* lightIsIlluminateBuffer = nullptr;
			ManyArrayBuffer<glm::vec4>* lightRadianceBuffer = nullptr;
			ManyArrayBuffer<bool>* missIsMissBuffer = nullptr;
			ManyArrayBuffer<glm::vec4>* missRadianceBuffer = nullptr;
			ManyArrayBuffer<glm::vec4>* integratorTotalRadianceBuffer = nullptr;
			ManyArrayBuffer<glm::vec4>* integratorTotalIndirectBuffer = nullptr;
			ManyArrayBuffer<float>* integratorPdfBuffer = nullptr;
			ManyArrayBuffer<glm::vec4>* samplingFinalColorBuffer = nullptr;
			ManyArrayBuffer<uint32_t>* samplingCountSampleBuffer = nullptr;

			std::vector<NugieVulkan::Image*> resultImages{};
			
			DescriptorSet* rayIntersectDescSet = nullptr;
			DescriptorSet* indirectRayGenDescSet = nullptr;
			DescriptorSet* indirectRayHitDescSet = nullptr;
			DescriptorSet* lightRayHitDescSet = nullptr;
			DescriptorSet* missRayDescSet = nullptr;
			DescriptorSet* directRayGenDescSet = nullptr;
			DescriptorSet* directRayHitDescSet = nullptr;
			DescriptorSet* integratorDescSet = nullptr;
			DescriptorSet* samplingDescSet = nullptr;

			uint32_t frameCount = 0u, randomSeed = 0u;
			bool isRendering = true;

			RayTraceUbo rayTraceUbo;
	};
}