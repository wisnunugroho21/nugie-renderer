#ifndef NUGIE_DEVICE_HPP
#define NUGIE_DEVICE_HPP

#include <webgpu/webgpu.hpp>
#include <GLFW/glfw3.h>
#include <glfw3webgpu.h>

#include "../buffer/master/master_buffer.hpp"

namespace nugie {
    class MasterBuffer;
    
    class Device {
    public:
        Device();
        Device(const char* appTitle, int width, int height);

        ~Device();

        // ================================ Getter Function ================================

        GLFWwindow* getWindow() { return this->window; }

        wgpu::Queue getQueue() { return this->queue; }

        wgpu::TextureFormat getSurfaceFormat() { return this->surfaceFormat; }

        wgpu::Surface getSurface() { return this->surface; }

        wgpu::TextureView getNextSurfaceTextureView();        

        // ================================ WebGPU Creation Function ================================

        wgpu::Buffer createBuffer(wgpu::BufferDescriptor desc);

        wgpu::Texture createTexture(wgpu::TextureDescriptor desc) ;

        wgpu::Sampler createSampler(wgpu::SamplerDescriptor desc);

        wgpu::BindGroupLayout createBindGroupLayout(wgpu::BindGroupLayoutDescriptor desc);

        wgpu::PipelineLayout createPipelineLayout(wgpu::PipelineLayoutDescriptor desc);

        wgpu::BindGroup createBindGroup(wgpu::BindGroupDescriptor desc);

        wgpu::ShaderModule createShaderModule(wgpu::ShaderModuleDescriptor desc) ;

        wgpu::RenderPipeline createRenderPipeline(wgpu::RenderPipelineDescriptor desc);

        wgpu::ComputePipeline createComputePipeline(wgpu::ComputePipelineDescriptor desc);

        wgpu::CommandEncoder createCommandEncoder(wgpu::CommandEncoderDescriptor desc);

        wgpu::RenderBundleEncoder createRenderBundleEncoder(wgpu::RenderBundleEncoderDescriptor desc);

        // ================================ Nugie Creation Function ================================

        MasterBuffer* createMasterBuffer(wgpu::BufferDescriptor desc);

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

#endif