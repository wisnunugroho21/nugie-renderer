#pragma once

#include <webgpu/webgpu.hpp>
#include <GLFW/glfw3.h>
#include <glfw3webgpu.h>

namespace nugie {
    class Device {
    public:
        Device();
        Device(const char* appTitle, int width, int height);

        ~Device();

        // ================================ Getter Function ================================

        wgpu::Queue getQueue() { return this->queue; }

        wgpu::TextureFormat getSurfaceFormat() { return this->surfaceFormat; }

        wgpu::Surface getSurface() { return this->surface; }

        wgpu::TextureView getNextSurfaceTextureView();        

        // ================================ WebGPU Creation Function ================================

        wgpu::Buffer createBuffer(wgpu::BufferDescriptor desc);

        wgpu::Texture createTexture(wgpu::TextureDescriptor desc) ;

        wgpu::ShaderModule createShaderModule(wgpu::ShaderModuleDescriptor desc) ;

        wgpu::RenderPipeline createRenderPipeline(wgpu::RenderPipelineDescriptor desc);

        wgpu::ComputePipeline createComputePipeline(wgpu::ComputePipelineDescriptor desc);

        wgpu::CommandEncoder createCommandEncoder(wgpu::CommandEncoderDescriptor desc);

        // ================================ Lifecycle Function ================================

        bool initialize(const char* appTitle, int width, int height);

        void terminate();

        bool isRunning();

        void poolEvents();

    private:
        wgpu::Instance instance;
        wgpu::Adapter adapter;
        wgpu::Device device;
        wgpu::Queue queue;
        wgpu::Surface surface;

        GLFWwindow *window;
        wgpu::TextureFormat surfaceFormat = wgpu::TextureFormat::Undefined;

        std::unique_ptr<wgpu::ErrorCallback> uncapturedErrorCallbackHandle;
    };
}