#pragma once

#include "../../vulkan/window/window.hpp"
#include "../../vulkan/device/device.hpp"
#include "../../vulkan/texture/texture.hpp"
#include "../../vulkan/buffer/buffer.hpp"
#include "../../vulkan/texture/texture.hpp"
#include "../camera/camera.hpp"
#include "../controller/keyboard/keyboard_controller.hpp"
#include "../controller/mouse/mouse_controller.hpp"
#include "../data/buffer/ssbo.hpp"
#include "../data/buffer/ubo.hpp"
#include "../data/buffer/vertex.hpp"
#include "../data/buffer/index.hpp"
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
#include "../utils/transform/transform.hpp"

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

			void initCamera(uint32_t width, uint32_t height);
			void recreateSubRendererAndSubsystem();

			NugieVulkan::Window* window;
			NugieVulkan::Device* device;

			Camera* camera;
			KeyboardController* keyboardController;
			MouseController* mouseController;

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

			IndexBufferObject<uint32_t>* indexModel;

			VertexBufferObject<Position>* positionModel;
			VertexBufferObject<Normal>* normalModel;
			VertexBufferObject<TextCoord>* textCoordModel;
			VertexBufferObject<Reference>* referenceModel;
			
			ShaderStorageBufferObject<Material>* materialModel;
			ShaderStorageBufferObject<Transformation>* transformationModel;
			ShaderStorageBufferObject<ShadowTransformation>* shadowTransformationModel;
			ShaderStorageBufferObject<PointLight>* pointLightModel;
			ShaderStorageBufferObject<SpotLight>* spotLightModel;

			UniformBufferObject<ForwardUbo>* forwardUniform;
			UniformBufferObject<DeferredUbo>* deferredUniform;
			
			ForwardDescSet* forwardDescSet;
			AttachmentDeferredDescSet* attachmentDeferredDescSet;
			ModelDeferredDescSet* modelDeferredDescSet;
			PointShadowDescSet* pointShadowDescSet;
			SpotShadowDescSet* spotShadowDescSet;

			uint32_t randomSeed = 0u, pointNumLight = 0u, spotNumLight = 0u, cameraUpdateCount = 0u;
			bool isRendering = true;
			float frameTime = 0.0f;

			ForwardUbo forwardUbo;
			DeferredUbo deferredUbo;

			std::vector<NugieVulkan::Texture*> colorTextures;
	};
}