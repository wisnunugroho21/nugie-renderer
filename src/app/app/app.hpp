#pragma once

#include "../../vulkan/window/window.hpp"
#include "../../vulkan/device/device.hpp"
#include "../../vulkan/texture/texture.hpp"
#include "../../vulkan/buffer/buffer.hpp"
#include "../data/model/index_model.hpp"
#include "../data/model/position_model.hpp"
#include "../data/model/normal_model.hpp"
#include "../data/model/reference_model.hpp"
#include "../data/model/object_model.hpp"
#include "../data/model/primitive_model.hpp"
#include "../data/model/triangle_light_model.hpp"
#include "../data/model/material_model.hpp"
#include "../data/model/transformation_model.hpp"
#include "../data/buffer/raster_uniform.hpp"
#include "../data/buffer/ray_tracing_uniform.hpp"
#include "../data/descSet/forward_desc_set.hpp"
#include "../data/descSet/model_deferred_desc_set.hpp"
#include "../data/descSet/attachment_deferred_desc_set.hpp"
#include "../renderer/hybrid_renderer.hpp"
#include "../renderer_sub/raytracing_sub_renderer.hpp"
#include "../renderer_subpart/forward_subpart_renderer.hpp"
#include "../renderer_subpart/deferred_subpart_renderer.hpp"
#include "../renderer_system/forward_pass_render_system.hpp"
#include "../renderer_system/deferred_pass_render_system.hpp"

#include <memory>
#include <vector>

#define APP_TITLE "Testing Vulkan"

namespace NugieApp {
	class App
	{
		public:
			static constexpr int WIDTH = 800;
			static constexpr int HEIGHT = 800;

			App();
			~App();

			void run();
			void renderLoop();

		private:
			void loadObjects();
			void loadQuadModels();

			void updateCamera(uint32_t width, uint32_t height);
			void recreateSubRendererAndSubsystem();

			NugieVulkan::Window* window;
			NugieVulkan::Device* device;

			HybridRenderer* renderer;
			RayTracingSubRenderer* rayTracingSubRenderer;
			ForwardSubPartRenderer* forwardSubPartRenderer;
			DeferredSubPartRenderer* deferredSubPartRenderer;
			ForwardPassRenderSystem* forwardPassRenderer;
			DeferredPassRenderSystem* deferredPasRenderer;

			IndexModel* indexModel;
			PositionModel* positionModel;
			NormalModel* normalModel;
			ReferenceModel* referenceModel;
			PrimitiveModel* primitiveModel;
			TriangleLightModel* triangleLightModel;
			ObjectModel* objectModel;
			MaterialModel* materialModel;
			TransformationModel* transformationModel;

			RasterUniform* rasterUniforms;
			RayTracingUniform* rayTracingUniform;
			ForwardDescSet* forwardDescSet;
			AttachmentDeferredDescSet* attachmentDeferredDescSet;
			ModelDeferredDescSet* modelDeferredDescSet;

			uint32_t randomSeed = 0, numLight = 0;
			bool isRendering = true;
			float frameTime = 0;

			RasterUbo rasterUbo;
			RayTraceUbo rayTraceUbo;
	};
}