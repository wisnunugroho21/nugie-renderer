#pragma once

#include "../../vulkan/window/window.hpp"
#include "../../vulkan/device/device.hpp"
#include "../../vulkan/texture/texture.hpp"
#include "../../vulkan/buffer/buffer.hpp"
#include "../../vulkan/texture/texture.hpp"
#include "../camera/camera.hpp"
#include "../data/model/index_model.hpp"
#include "../data/model/position_model.hpp"
#include "../data/model/normal_model.hpp"
#include "../data/model/textCoord_model.hpp"
#include "../data/model/reference_model.hpp"
#include "../data/model/material_model.hpp"
#include "../data/model/transformation_model.hpp"
#include "../data/model/point_light_model.hpp"
#include "../data/buffer/shadow_uniform.hpp"
#include "../data/buffer/forward_uniform.hpp"
#include "../data/buffer/deferred_uniform.hpp"
#include "../data/descSet/shadow_desc_set.hpp"
#include "../data/descSet/forward_desc_set.hpp"
#include "../data/descSet/model_deferred_desc_set.hpp"
#include "../data/descSet/attachment_deferred_desc_set.hpp"
#include "../renderer/hybrid_renderer.hpp"
#include "../renderer_sub/final_sub_renderer.hpp"
#include "../renderer_sub/shadow_sub_renderer.hpp"
#include "../renderer_subpart/forward_subpart_renderer.hpp"
#include "../renderer_subpart/deferred_subpart_renderer.hpp"
#include "../renderer_subpart/shadow_subpart_renderer.hpp"
#include "../renderer_system/shadow_pass_render_system.hpp"
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

			void updateCamera(uint32_t width, uint32_t height);
			void recreateSubRendererAndSubsystem();

			NugieVulkan::Window* window;
			NugieVulkan::Device* device;

			Camera* camera;

			HybridRenderer* renderer;

			FinalSubRenderer* finalSubRenderer;
			ShadowSubRenderer* shadowSubRenderer;

			ForwardSubPartRenderer* forwardSubPartRenderer;
			DeferredSubPartRenderer* deferredSubPartRenderer;
			ShadowSubPartRenderer* shadowSubPartRenderer;
			
			ForwardPassRenderSystem* forwardPassRenderer;
			DeferredPassRenderSystem* deferredPasRenderer;
			ShadowPassRenderSystem* shadowPassRenderer;

			IndexModel* indexModel;
			PositionModel* positionModel;
			NormalModel* normalModel;
			TextCoordModel* textCoordModel;
			ReferenceModel* referenceModel;
			MaterialModel* materialModel;
			TransformationModel* transformationModel;
			PointLightModel* pointLightModel;

			ShadowUniform* shadowUniform;
			ForwardUniform* forwardUniform;
			DeferredUniform* deferredUniform;
			
			ForwardDescSet* forwardDescSet;
			AttachmentDeferredDescSet* attachmentDeferredDescSet;
			ModelDeferredDescSet* modelDeferredDescSet;
			ShadowDescSet* shadowDescSet;

			uint32_t randomSeed = 0, numLight = 0;
			bool isRendering = true;
			float frameTime = 0.0f, shadowFarPlane = 0.0f;

			ShadowUbo shadowUbo;
			ForwardUbo forwardUbo;
			DeferredUbo deferredUbo;

			NugieVulkan::Texture* colorTexture;
	};
}