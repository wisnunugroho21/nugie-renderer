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
#include "../data/descSet/terrain_desc_set.hpp"
#include "../renderer/renderer.hpp"
#include "../renderer_sub/sub_renderer.hpp"
#include "../renderer_subpart/terrain_subpart_renderer.hpp"
#include "../renderer_system/terrain_pass_render_system.hpp"
#include "../utils/transform/transform.hpp"

#include <memory>
#include <vector>

#define APP_TITLE "Nugie Renderer"

#define WIDTH 800
#define HEIGHT 800
#define SHADOW_RESOLUTION 1024

namespace NugieApp {
	class TerrainApp
	{
		public:
			TerrainApp();
			~TerrainApp();

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

			TerrainSubPartRenderer* terrainSubPartRenderer;
			TerrainPassRenderSystem* terrainPassRenderer;

			IndexBufferObject<uint32_t>* indexModel;
			VertexBufferObject<Position>* positionModel;

			UniformBufferObject<ForwardUbo>* terrainUniform;
			TerrainDescSet* terrainDescSet;

			uint32_t randomSeed = 0u, cameraUpdateCount = 0u;

			bool isRendering = true;
			float frameTime = 0.0f;

			ForwardUbo forwardUbo;
	};
}