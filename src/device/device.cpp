#define WEBGPU_CPP_IMPLEMENTATION
#include <webgpu/webgpu.hpp>

#include "device.hpp"
#include <iostream>

namespace nugie {
    Device::Device() {

    }
    
    Device::Device(const char* appTitle, int width, int height) {
        this->initialize(appTitle, width, height);
    }

    Device::~Device() {
        this->terminate();
    }

    wgpu::TextureView Device::getNextSurfaceTextureView() {
        // Get the next target texture view
        wgpu::SurfaceTexture surfaceTexture;
        this->surface.getCurrentTexture(&surfaceTexture);

        if (surfaceTexture.status != wgpu::SurfaceGetCurrentTextureStatus::Success) {
            return nullptr;
        }

        wgpu::Texture texture = surfaceTexture.texture;

        wgpu::TextureViewDescriptor viewDescriptor;
        viewDescriptor.nextInChain = nullptr;
        viewDescriptor.label = "Surface Texture View";
        viewDescriptor.format = texture.getFormat();
        viewDescriptor.dimension = wgpu::TextureViewDimension::_2D;
        viewDescriptor.baseMipLevel = 0;
        viewDescriptor.mipLevelCount = 1;
        viewDescriptor.baseArrayLayer = 0;
        viewDescriptor.arrayLayerCount = 1;
        viewDescriptor.aspect = wgpu::TextureAspect::All;
        wgpu::TextureView targetView = texture.createView(viewDescriptor);

        #ifndef WEBGPU_BACKEND_WGPU
            // We no longer need the texture, only its view
            // (NB: with wgpu::-native, surface textures must not be manually released)
            texture.release();
        #endif // WEBGPU_BACKEND_WGPU

        return targetView;
    }

    wgpu::Buffer Device::createBuffer(wgpu::BufferDescriptor desc) {
        return this->device.createBuffer(desc);
    }

    wgpu::Texture Device::createTexture(wgpu::TextureDescriptor desc) {
        return this->device.createTexture(desc);
    }

    wgpu::ShaderModule Device::createShaderModule(wgpu::ShaderModuleDescriptor desc) {
        return this->device.createShaderModule(desc);
    }

    wgpu::RenderPipeline Device::createRenderPipeline(wgpu::RenderPipelineDescriptor desc) {
        return this->device.createRenderPipeline(desc);
    }

    wgpu::ComputePipeline Device::createComputePipeline(wgpu::ComputePipelineDescriptor desc) {
        return this->device.createComputePipeline(desc);
    }

    wgpu::CommandEncoder Device::createCommandEncoder(wgpu::CommandEncoderDescriptor desc) {
        return this->device.createCommandEncoder(desc);
    }

    bool Device::initialize(const char* appTitle, int width, int height) {
        // We create a descriptor
        wgpu::InstanceDescriptor instanceDesc = {};
        instanceDesc.nextInChain = nullptr;

        // We create the instance using this descriptor
        this->instance = wgpu::createInstance(instanceDesc);

        // We can check whether there is actually an instance created
        if (!instance) {
            std::cerr << "Could not initialize WebGPU!" << std::endl;
            return false;
        }

        wgpu::RequestAdapterOptions adapterOpts = {};
        adapterOpts.nextInChain = nullptr;
        this->adapter = this->instance.requestAdapter(adapterOpts);

        wgpu::DeviceDescriptor deviceDesc = {};
        deviceDesc.nextInChain = nullptr;
        deviceDesc.label = "This Device"; // anything works here, that's your call
        deviceDesc.requiredFeatureCount = 0; // we do not require any specific feature
        deviceDesc.defaultQueue.nextInChain = nullptr;
        deviceDesc.defaultQueue.label = "This queue";

        deviceDesc.deviceLostCallbackInfo = {};
        deviceDesc.deviceLostCallbackInfo.mode = wgpu::CallbackMode::AllowSpontaneous;
        deviceDesc.deviceLostCallbackInfo.callback = [](WGPUDevice const* /* device */, WGPUDeviceLostReason reason, const char* message, void* /* pUserdata */) {
            std::cout << "Device lost: reason " << reason;
            if (message) std::cout << " (" << message << ")";
            std::cout << std::endl;
        };

        this->device = this->adapter.requestDevice(deviceDesc);
        this->queue = this->device.getQueue();

        auto onDeviceError = [](wgpu::ErrorType type, char const* message) {
            std::cout << "Uncaptured device error: type " << type;
            if (message) std::cout << " (" << message << ")";
            std::cout << std::endl;
        };

        uncapturedErrorCallbackHandle = this->device.setUncapturedErrorCallback(onDeviceError);

        if (!glfwInit()) {
            std::cerr << "Could not initialize GLFW!" << std::endl;
            return false;
        }

        glfwWindowHint(GLFW_CLIENT_API, GLFW_NO_API); // <-- extra info for glfwCreateWindow
        glfwWindowHint(GLFW_RESIZABLE, GLFW_FALSE);

        this->window = glfwCreateWindow(width, height, appTitle, nullptr, nullptr);

        // Get the surface
        this->surface = glfwGetWGPUSurface(this->instance, window);

        wgpu::SurfaceCapabilities surfaceCapability;
        this->surface.getCapabilities(this->adapter, &surfaceCapability);

        this->surfaceFormat = surfaceCapability.formats[0];

        wgpu::SurfaceConfiguration config = {};
        config.nextInChain = nullptr;
        config.width = width;
        config.height = height;
        config.format = this->surfaceFormat;
        config.viewFormatCount = 0;
        config.viewFormats = nullptr;
        config.usage = wgpu::TextureUsage::RenderAttachment;
        config.device = this->device;
        config.presentMode = wgpu::PresentMode::Fifo;
        config.alphaMode = surfaceCapability.alphaModes[0];

        this->surface.configure(config);

        return true;
    }

    void Device::terminate() {
        this->surface.unconfigure();
        this->surface.release();

        glfwDestroyWindow(window);
        
        this->queue.release();
        this->device.release();
        this->adapter.release();
        this->instance.release();
    }    

    bool Device::isRunning() {
        return !glfwWindowShouldClose(this->window);
    }
    
    void Device::poolEvents() {
        glfwPollEvents();
    }
}