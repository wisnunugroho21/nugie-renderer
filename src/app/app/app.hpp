#pragma once

#include "../../vulkan/window/window.hpp"
#include "../../vulkan/device/device.hpp"
#include "../../vulkan/buffer/buffer.hpp"
#include "../camera/camera.hpp"
#include "../controller/keyboard/keyboard_controller.hpp"
#include "../controller/mouse/mouse_controller.hpp"
#include "../data/buffer/ssbo.hpp"
#include "../data/buffer/ubo.hpp"
#include "../data/buffer/vertex.hpp"
#include "../data/buffer/index.hpp"
#include "../data/descSet/descriptor_set.hpp"
#include "../data/texture/texture.hpp"
#include "../renderer/renderer.hpp"
#include "../renderer_sub/sub_renderer.hpp"
#include "../renderer_system/forward_pass_render_system.hpp"
#include "../renderer_system/deferred_pass_render_system.hpp"
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

			SubRenderer* finalSubRenderer;
			SubRenderer* spotShadowSubRenderer;
			
			ForwardPassRenderSystem* forwardPassRenderer;
			DeferredPassRenderSystem* deferredPasRenderer;

			IndexBufferObject<uint32_t>* indexModel;

			VertexBufferObject<Position>* positionModel;
			VertexBufferObject<Normal>* normalModel;
			VertexBufferObject<TextCoord>* textCoordModel;
			VertexBufferObject<Reference>* referenceModel;
			
			ShaderStorageBufferObject<Material>* materialModel;
			ShaderStorageBufferObject<Transformation>* transformationModel;
			ShaderStorageBufferObject<SpotLight>* spotLightModel;

			UniformBufferObject<ForwardUbo>* forwardUniform;
			UniformBufferObject<DeferredUbo>* deferredUniform;
			
			DescriptorSet* forwardDescSet;
			DescriptorSet* attachmentDeferredDescSet;
			DescriptorSet* modelDeferredDescSet;

			uint32_t randomSeed = 0u, spotNumLight = 0u, cameraUpdateCount = 0u;

			bool isRendering = true;
			float frameTime = 0.0f;

			ForwardUbo forwardUbo;
			DeferredUbo deferredUbo;

			std::vector<NugieApp::Texture*> colorTextures;
	};
}