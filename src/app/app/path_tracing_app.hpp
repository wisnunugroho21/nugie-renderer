#pragma once

#include "../../vulkan/window/window.hpp"
#include "../../vulkan/device/device.hpp"
#include "../../vulkan/buffer/buffer.hpp"
#include "../path_tracing_struct.hpp"
#include "../camera/camera.hpp"
#include "../controller/keyboard/keyboard_controller.hpp"
#include "../controller/mouse/mouse_controller.hpp"
#include "../data/buffer/stacked_object_buffer.hpp"
#include "../data/buffer/stacked_array_buffer.hpp"
#include "../data/buffer/stacked_array_many_buffer.hpp"
#include "../data/descSet/descriptor_set.hpp"
#include "../data/texture/texture.hpp"
#include "../data/texture/heightmap_texture.hpp"
#include "../data/texture/cubemap_texture.hpp"
#include "../renderer/renderer.hpp"
#include "../renderer_sub/sub_renderer.hpp"
#include "../renderer_system/compute_render_system.hpp"
#include "../renderer_system/path_tracing/final_pass_render_system.hpp"
#include "../utils/transform/transform.hpp"

#include <memory>
#include <vector>

#define APP_TITLE "Nugie Renderer"
// #define USE_RASTER

#define WIDTH 800
#define HEIGHT 800
#define SHADOW_RESOLUTION 2048

namespace NugieApp {
    class PathTracingApp {
    public:
        PathTracingApp();

        ~PathTracingApp();

        void recordCommand();

        void run();
        void renderLoop();

    private:
        void loadData();

        void initCamera(uint32_t width, uint32_t height);

        void init();
        void resize();

        NugieVulkan::Window *window = nullptr;
        NugieVulkan::Device *device = nullptr;

        Camera *camera = nullptr;
        KeyboardController *keyboardController = nullptr;
        MouseController *mouseController = nullptr;

        Renderer *renderer = nullptr;

#ifdef USE_RASTER
        SubRenderer *subRenderer = nullptr;
#endif

        ComputeRenderSystem *rayIntersectRenderer = nullptr;
        ComputeRenderSystem *indirectRayGenRenderer = nullptr;
        ComputeRenderSystem *indirectRayHitRenderer = nullptr;
        ComputeRenderSystem *lightRayHitRenderer = nullptr;
        ComputeRenderSystem *missRayRenderer = nullptr;
        ComputeRenderSystem *directRayGenRenderer = nullptr;
        ComputeRenderSystem *directRayHitRenderer = nullptr;
        ComputeRenderSystem *integratorRenderer = nullptr;
        ComputeRenderSystem *samplingRenderer = nullptr;

#ifdef USE_RASTER
        FinalPassRenderSystem *finalPassRenderer = nullptr;
#endif
    
        StackedArrayBuffer *dataBuffer = nullptr;
        StackedObjectBuffer *uniformBuffer = nullptr;
        StackedArrayManyBuffer *rayTraceStorageBuffer = nullptr;

        DescriptorSet *terrainDescSet = nullptr;
        DescriptorSet *forwardDescSet = nullptr;
        DescriptorSet *shadowDescSet = nullptr;
        DescriptorSet *skyboxDescSet = nullptr;

#ifdef USE_RASTER
        NugieVulkan::Sampler *resultSampler = nullptr;
#endif

        DescriptorSet *rayIntersectDescSet = nullptr;
        DescriptorSet *indirectRayGenDescSet = nullptr;
        DescriptorSet *indirectRayHitDescSet = nullptr;
        DescriptorSet *lightRayHitDescSet = nullptr;
        DescriptorSet *missRayDescSet = nullptr;
        DescriptorSet *directRayGenDescSet = nullptr;
        DescriptorSet *directRayHitDescSet = nullptr;
        DescriptorSet *integratorDescSet = nullptr;
        DescriptorSet *samplingDescSet = nullptr;

        bool isRendering = true;
        RenderData renderData;

        NugiePathTracing::Ubo rayTraceUbo{};

#ifdef USE_RASTER
        DescriptorSet *finalDescSet = nullptr;
#endif
    };
}