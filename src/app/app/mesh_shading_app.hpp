#pragma once

#include "../../vulkan/window/window.hpp"
#include "../../vulkan/device/device.hpp"
#include "../../vulkan/buffer/buffer.hpp"
#include "../camera/camera.hpp"
#include "../controller/keyboard/keyboard_controller.hpp"
#include "../controller/mouse/mouse_controller.hpp"
#include "../data/buffer/stacked_object_buffer.hpp"
#include "../data/descSet/descriptor_set.hpp"
#include "../data/texture/texture.hpp"
#include "../renderer/renderer.hpp"
#include "../renderer_sub/sub_renderer.hpp"
#include "../renderer_system/mesh_shader/mesh_render_system.hpp"
#include "../utils/transform/transform.hpp"

#include <memory>
#include <vector>

#define APP_TITLE "Nugie Renderer"

#define WIDTH 800
#define HEIGHT 800
#define SHADOW_RESOLUTION 2048

namespace NugieApp {
    class MeshShadingApp {
    public:
        MeshShadingApp();
        ~MeshShadingApp();

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

        StackedObjectBuffer *meshUniformBuffer = nullptr;
        DescriptorSet *meshDescSet = nullptr;

        Renderer *renderer = nullptr;
        SubRenderer *finalSubRenderer = nullptr;        
        MeshRenderSystem *meshRenderer = nullptr;

        Camera *camera = nullptr;
        KeyboardController *keyboardController = nullptr;
        MouseController *mouseController = nullptr;

        CameraMatrix cameraMatrix;

        uint32_t randomSeed = 0u, spotNumLight = 0u, cameraUpdateCount = 0u, frameCount = 0;
        bool isRendering = true;
    };
}