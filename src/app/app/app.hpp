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
#include "../data/model/shadow_transformation_model.hpp"
#include "../data/model/point_light_model.hpp"
#include "../data/model/spot_light_model.hpp"
#include "../data/buffer/forward_uniform.hpp"
#include "../data/buffer/deferred_uniform.hpp"
#include "../data/descSet/point_shadow_desc_set.hpp"
#include "../data/descSet/spot_shadow_desc_set.hpp"
#include "../data/descSet/forward_desc_set.hpp"
#include "../data/descSet/model_deferred_desc_set.hpp"
#include "../data/descSet/attachment_deferred_desc_set.hpp"
#include "../renderer/renderer.hpp"
#include "../renderer_sub/sub_renderer.hpp"
#include "../renderer_subpart/forward_subpart_renderer.hpp"
#include "../renderer_subpart/deferred_subpart_renderer.hpp"
#include "../renderer_subpart/point_shadow_subpart_renderer.hpp"
#include "../renderer_subpart/spot_shadow_subpart_renderer.hpp"
#include "../renderer_system/point_shadow_pass_render_system.hpp"
#include "../renderer_system/spot_shadow_pass_render_system.hpp"
#include "../renderer_system/forward_pass_render_system.hpp"
#include "../renderer_system/deferred_pass_render_system.hpp"
#include "../data/model/ssbo.hpp"

#include <memory>
#include <vector>

#define APP_TITLE "Testing Vulkan"

#define WIDTH 800
#define HEIGHT 800
#define SHADOW_RESOLUTION 1024

namespace NugieApp {
	class App
	{
		public:
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

			Renderer* renderer;

			SubRenderer* finalSubRenderer;
			SubRenderer* pointShadowSubRenderer;
			SubRenderer* spotShadowSubRenderer;

			ForwardSubPartRenderer* forwardSubPartRenderer;
			DeferredSubPartRenderer* deferredSubPartRenderer;
			PointShadowSubPartRenderer* pointShadowSubPartRenderer;
			SpotShadowSubPartRenderer* spotShadowSubPartRenderer;
			
			ForwardPassRenderSystem* forwardPassRenderer;
			DeferredPassRenderSystem* deferredPasRenderer;
			PointShadowPassRenderSystem* pointShadowPassRenderer;
			SpotShadowPassRenderSystem* spotShadowPassRenderer;

			ShaderStorageBufferObject<uint32_t>* indexModel;
			ShaderStorageBufferObject<Position>* positionModel;
			ShaderStorageBufferObject<Normal>* normalModel;
			ShaderStorageBufferObject<TextCoord>* textCoordModel;
			ShaderStorageBufferObject<Reference>* referenceModel;
			ShaderStorageBufferObject<Material>* materialModel;
			ShaderStorageBufferObject<Transformation>* transformationModel;
			ShaderStorageBufferObject<ShadowTransformation>* shadowTransformationModel;
			ShaderStorageBufferObject<PointLight>* pointLightModel;
			ShaderStorageBufferObject<SpotLight>* spotLightModel;

			ForwardUniform* forwardUniform;
			DeferredUniform* deferredUniform;
			
			ForwardDescSet* forwardDescSet;
			AttachmentDeferredDescSet* attachmentDeferredDescSet;
			ModelDeferredDescSet* modelDeferredDescSet;
			PointShadowDescSet* pointShadowDescSet;
			SpotShadowDescSet* spotShadowDescSet;

			uint32_t randomSeed = 0, pointNumLight = 0, spotNumLight = 0;
			bool isRendering = true;
			float frameTime;

			ForwardUbo forwardUbo;
			DeferredUbo deferredUbo;

			std::vector<NugieVulkan::Texture*> colorTextures;
	};
}