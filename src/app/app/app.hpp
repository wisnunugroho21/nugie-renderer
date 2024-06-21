#pragma once

#include "../../vulkan/window/window.hpp"
#include "../../vulkan/device/device.hpp"
#include "../../vulkan/device/device_procedure.hpp"
#include "../../vulkan/buffer/buffer.hpp"
#include "../camera/camera.hpp"
#include "../controller/keyboard/keyboard_controller.hpp"
#include "../controller/mouse/mouse_controller.hpp"
#include "../data/buffer/stacked_array_buffer.hpp"
#include "../data/buffer/stacked_object_buffer.hpp"
#include "../data/descSet/descriptor_set.hpp"
#include "../data/texture/texture.hpp"
#include "../data/texture/heightmap_texture.hpp"
#include "../data/texture/cubemap_texture.hpp"
#include "../renderer/renderer.hpp"
#include "../renderer_sub/sub_renderer.hpp"
#include "../renderer_system/forward_pass_render_system.hpp"
#include "../renderer_system/terrain_pass_render_system.hpp"
#include "../renderer_system/shadow_pass_render_system.hpp"
#include "../renderer_system/skybox_pass_render_system.hpp"
#include "../renderer_system/mesh_render_system.hpp"
#include "../utils/transform/transform.hpp"

#include <memory>
#include <vector>

#define APP_TITLE "Nugie Renderer"

#define WIDTH 800
#define HEIGHT 800
#define SHADOW_RESOLUTION 2048

namespace NugieApp {
    class App {
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

        NugieVulkan::Window *window = nullptr;
        NugieVulkan::Device *device = nullptr;
        NugieVulkan::DeviceProcedures *deviceProcedures = nullptr;

        Camera *camera = nullptr;
        KeyboardController *keyboardController = nullptr;
        MouseController *mouseController = nullptr;

        Renderer *renderer = nullptr;
        SubRenderer *finalSubRenderer = nullptr;        
        MeshRenderSystem *meshRenderer = nullptr;
        
        StackedObjectBuffer *uniformBuffer = nullptr;
        StackedArrayBuffer *geometryBuffer = nullptr;

        DescriptorSet *meshDescSet = nullptr;

        uint32_t randomSeed = 0u, spotNumLight = 0u, cameraUpdateCount = 0u,
                 frameCount = 0, verticeTerrainCount = 0, indicesTerrainCount = 0u;

        CameraTransformation cameraTransformation;
        bool isRendering = true;
    };
}