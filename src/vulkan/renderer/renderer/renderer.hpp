#pragma once

#include "../../object/window/window.hpp"
#include "../../object/device/device.hpp"
#include "../../object/buffer/buffer.hpp"
#include "../camera/camera.hpp"
#include "../controller/keyboard/keyboard_controller.hpp"
#include "../controller/mouse/mouse_controller.hpp"
#include "../data/buffer/array_buffer.hpp"
#include "../data/buffer/object_buffer.hpp"
#include "../data/buffer/many_array_buffer.hpp"
#include "../data/descSet/descriptor_set.hpp"
#include "../data/texture/texture.hpp"
#include "../data/texture/heightmap_texture.hpp"
#include "../data/texture/cubemap_texture.hpp"
#include "../renderer_head/renderer_head.hpp"
#include "../renderer_pass/renderer_pass.hpp"
#include "../renderer_system/compute_renderer_system.hpp"
#include "../renderer_system/forward_pass_renderer_system.hpp"
#include "../renderer_system/terrain_pass_renderer_system.hpp"
#include "../renderer_system/shadow_pass_renderer_system.hpp"
#include "../renderer_system/skybox_pass_renderer_system.hpp"
#include "../utils/transform/transform.hpp"

#include <memory>
#include <vector>

#define APP_TITLE "Nugie Renderer"

#define WIDTH 1280
#define HEIGHT 720
#define SHADOW_RESOLUTION 2048

namespace NugieApp {
	class VulkanRenderer
	{
		public:
			VulkanRenderer();
			~VulkanRenderer();

			void recordCommand();

			void run();
			void renderLoop();

			void singleThreadRun();

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

			RendererHead* rendererHead = nullptr;

			RendererPass* finalRendererPass = nullptr;
			RendererPass* shadowRendererPass = nullptr;			
			
			TerrainPassRendererSystem* terrainRenderer = nullptr;
			ForwardPassRendererSystem* forwardPassRenderer = nullptr;
			ShadowPassRendererSystem* shadowPassRenderer = nullptr;
			SkyboxPassRendererSystem* skyboxRenderer = nullptr;

			ArrayBuffer<uint32_t>* indexBuffer = nullptr;
			ArrayBuffer<Vertex>* vertexBuffer = nullptr;
			ArrayBuffer<NormText>* normTextBuffer = nullptr;
			ArrayBuffer<Reference>* referenceBuffer = nullptr;
			
			ArrayBuffer<Material>* materialBuffer = nullptr;
			ArrayBuffer<Transformation>* transformationBuffer = nullptr;
			ArrayBuffer<ShadowTransformation>* shadowTransformationBuffer = nullptr;
			ArrayBuffer<SpotLight>* spotLightBuffer = nullptr;

			ObjectBuffer<RenderData>* renderDataBuffer = nullptr;			
			
			DescriptorSet* terrainDescSet = nullptr;
			DescriptorSet* forwardDescSet = nullptr;
			DescriptorSet* shadowDescSet = nullptr;
			DescriptorSet* skyboxDescSet = nullptr;

			uint32_t randomSeed = 0u, spotNumLight = 0u, cameraUpdateCount = 0u,
				frameCount = 0, verticeTerrainCount = 0, indicesTerrainCount = 0u;

			bool isRendering = true;
			RenderData renderData;

			HeightMapTexture* heightMapTexture;

			std::vector<Texture*> colorTextures;
			std::vector<Texture*> terrainTextures;
			CubeMapTexture* skyboxTexture;
	};
}