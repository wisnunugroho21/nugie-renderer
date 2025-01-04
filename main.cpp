// Includes
#include <iostream>
#include <cassert>
#include <vector>

#define WEBGPU_CPP_IMPLEMENTATION
#include <webgpu/webgpu.hpp>
#include <GLFW/glfw3.h>
#include <glfw3webgpu.h>

// We define a function that hides implementation-specific variants of device polling:
void wgpuPollEvents([[maybe_unused]] wgpu::Device device, [[maybe_unused]] bool yieldToWebBrowser) {
#if defined(WEBGPU_BACKEND_DAWN)
    device.tick();
#elif defined(WEBGPU_BACKEND_WGPU)
    device.poll(false);
#elif defined(WEBGPU_BACKEND_EMSCRIPTEN)
    if (yieldToWebBrowser) {
        emscripten_sleep(100);
    }
#endif
}

class Application {
public:
    // Initialize everything and return true if it went all right
    bool Initialize();

    // Uninitialize everything that was initialized
    void Terminate();

    // Draw a frame and handle events
    void MainLoop();

    // Return true as long as the main loop should keep on running
    bool IsRunning();
    
private:
    // We put here all the variables that are shared between init and main loop
    GLFWwindow *window;
    wgpu::TextureFormat surfaceFormat = wgpu::TextureFormat::Undefined;

    wgpu::Buffer vertexBuffer;
    wgpu::Buffer indexBuffer;
    uint32_t indexCount;

    wgpu::Instance instance;
    wgpu::Adapter adapter;
    wgpu::Device device;
    wgpu::Surface surface;
    wgpu::Queue queue;    
    wgpu::RenderPipeline pipeline;

    std::unique_ptr<wgpu::ErrorCallback> uncapturedErrorCallbackHandle;

    wgpu::RequiredLimits GetRequiredLimits();    
    wgpu::TextureView GetNextSurfaceTextureView();

    void InitializeBuffers();
    void InitializePipeline();
};

wgpu::RequiredLimits Application::GetRequiredLimits() {
    // Get adapter supported limits, in case we need them
    wgpu::SupportedLimits supportedLimits;
    adapter.getLimits(&supportedLimits);

    // Don't forget to = Default
    wgpu::RequiredLimits requiredLimits = {};

    // We use at most 1 vertex attribute for now
    requiredLimits.limits.maxVertexAttributes = 1;
    // We should also tell that we use 1 vertex buffers
    requiredLimits.limits.maxVertexBuffers = 1;
    // Maximum size of a buffer is 6 vertices of 2 float each
    requiredLimits.limits.maxBufferSize = 6 * 2 * sizeof(float);
    // Maximum stride between 2 consecutive vertices in the vertex buffer
    requiredLimits.limits.maxVertexBufferArrayStride = 2 * sizeof(float);

    // [...] Other device limits

    return requiredLimits;
}

wgpu::TextureView Application::GetNextSurfaceTextureView() {
    // Get the next target texture view
    wgpu::SurfaceTexture surfaceTexture;
    surface.getCurrentTexture(&surfaceTexture);

    if (surfaceTexture.status != wgpu::SurfaceGetCurrentTextureStatus::Success) {
        return nullptr;
    }

    wgpu::Texture texture = surfaceTexture.texture;

    wgpu::TextureViewDescriptor viewDescriptor;
    viewDescriptor.nextInChain = nullptr;
    viewDescriptor.label = "Surface texture view";
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

void Application::InitializeBuffers() {
    // Define point data
    // The de-duplicated list of point positions
    std::vector<float> pointData = {
        -0.5, -0.5, // Point #0 (A)
        +0.5, -0.5, // Point #1
        +0.5, +0.5, // Point #2 (C)
        -0.5, +0.5, // Point #3
    };

    // Define index data
    // This is a list of indices referencing positions in the pointData
    std::vector<uint16_t> indexData = {
        0, 1, 2, // Triangle #0 connects points #0, #1 and #2
        0, 2, 3  // Triangle #1 connects points #0, #2 and #3
    };

    // We will declare vertexCount as a member of the Application class
    indexCount = static_cast<uint32_t>(indexData.size());

    // Create vertex buffer
    wgpu::BufferDescriptor bufferDesc;
    bufferDesc.size = pointData.size() * sizeof(float);
    bufferDesc.usage = wgpu::BufferUsage::CopyDst | wgpu::BufferUsage::Vertex; // Vertex usage here!
    bufferDesc.mappedAtCreation = false;
    vertexBuffer = device.createBuffer(bufferDesc);

    // Upload geometry data to the buffer
    queue.writeBuffer(vertexBuffer, 0, pointData.data(), bufferDesc.size);

    // Create index buffer
    bufferDesc.size = indexData.size() * sizeof(uint16_t);
    bufferDesc.usage = wgpu::BufferUsage::CopyDst | wgpu::BufferUsage::Index; // Index usage here!
    indexBuffer = device.createBuffer(bufferDesc);
    
    // Upload geometry data to the buffer
    queue.writeBuffer(indexBuffer, 0, indexData.data(), bufferDesc.size);
}

void Application::InitializePipeline() {
    const char* shaderSource = R"(
        @vertex
        fn vs_main(@location(0) in_vertex_position: vec2f) -> @builtin(position) vec4f {
            return vec4f(in_vertex_position, 0.0, 1.0);
        }

        @fragment
        fn fs_main() -> @location(0) vec4f {
            return vec4f(0.0, 0.4, 1.0, 1.0);
        }
    )";

    wgpu::ShaderModuleWGSLDescriptor shaderCodeDesc;
    // Set the chained struct's header
    shaderCodeDesc.chain.next = nullptr;
    shaderCodeDesc.chain.sType = wgpu::SType::ShaderModuleWGSLDescriptor;
    shaderCodeDesc.code = shaderSource;    

    wgpu::ShaderModuleDescriptor shaderDesc;
    shaderDesc.nextInChain = &shaderCodeDesc.chain;

    wgpu::ShaderModule shaderModule = device.createShaderModule(shaderDesc);

    wgpu::RenderPipelineDescriptor pipelineDesc;

    // We do not use any vertex buffer for this first simplistic example
    wgpu::VertexAttribute positionAttrib;
    // == For each attribute, describe its layout, i.e., how to interpret the raw data ==
    // Corresponds to @location(...)
    positionAttrib.shaderLocation = 0;
    // Means vec2f in the shader
    positionAttrib.format = wgpu::VertexFormat::Float32x2;
    // Index of the first element
    positionAttrib.offset = 0;

    wgpu::VertexBufferLayout vertexBufferLayout;
    vertexBufferLayout.attributeCount = 1;
    vertexBufferLayout.attributes = &positionAttrib;
    // == Common to attributes from the same buffer ==
    vertexBufferLayout.arrayStride = 2 * sizeof(float);
    vertexBufferLayout.stepMode = wgpu::VertexStepMode::Vertex;

    pipelineDesc.vertex.bufferCount = 1;
    pipelineDesc.vertex.buffers = &vertexBufferLayout;

    // NB: We define the 'shaderModule' in the second part of this chapter.
    // Here we tell that the programmable vertex shader stage is described
    // by the function called 'vs_main' in that module.
    pipelineDesc.vertex.module = shaderModule;
    pipelineDesc.vertex.entryPoint = "vs_main";
    pipelineDesc.vertex.constantCount = 0;
    pipelineDesc.vertex.constants = nullptr;

    // Each sequence of 3 vertices is considered as a triangle
    pipelineDesc.primitive.topology = wgpu::PrimitiveTopology::TriangleList;

    // We'll see later how to specify the order in which vertices should be
    // connected. When not specified, vertices are considered sequentially.
    pipelineDesc.primitive.stripIndexFormat = wgpu::IndexFormat::Undefined;

    // The face orientation is defined by assuming that when looking
    // from the front of the face, its corner vertices are enumerated
    // in the counter-clockwise (CCW) order.
    pipelineDesc.primitive.frontFace = wgpu::FrontFace::CCW;

    // But the face orientation does not matter much because we do not
    // cull (i.e. "hide") the faces pointing away from us (which is often
    // used for optimization).
    pipelineDesc.primitive.cullMode = wgpu::CullMode::None;

    wgpu::BlendState blendState;
    blendState.color.srcFactor = wgpu::BlendFactor::SrcAlpha;
    blendState.color.dstFactor = wgpu::BlendFactor::OneMinusSrcAlpha;
    blendState.color.operation = wgpu::BlendOperation::Add;

    blendState.alpha.srcFactor = wgpu::BlendFactor::Zero;
    blendState.alpha.dstFactor = wgpu::BlendFactor::One;
    blendState.alpha.operation = wgpu::BlendOperation::Add;

    wgpu::ColorTargetState colorTarget;
    colorTarget.format = surfaceFormat;
    colorTarget.blend = &blendState;
    colorTarget.writeMask = wgpu::ColorWriteMask::All; // We could write to only some of the color channels.

    // We tell that the programmable fragment shader stage is described
    // by the function called 'fs_main' in the shader module.
    wgpu::FragmentState fragmentState;
    fragmentState.module = shaderModule;
    fragmentState.entryPoint = "fs_main";
    fragmentState.constantCount = 0;
    fragmentState.constants = nullptr;

    // We have only one target because our render pass has only one output color
    // attachment.
    fragmentState.targetCount = 1;
    fragmentState.targets = &colorTarget;

    pipelineDesc.fragment = &fragmentState;

    // We do not use stencil/depth testing for now
    pipelineDesc.depthStencil = nullptr;

    // Samples per pixel
    pipelineDesc.multisample.count = 1;
    // Default value for the mask, meaning "all bits on"
    pipelineDesc.multisample.mask = ~0u;
    // Default value as well (irrelevant for count = 1 anyways)
    pipelineDesc.multisample.alphaToCoverageEnabled = false;

    pipelineDesc.layout = nullptr;

    pipeline = device.createRenderPipeline(pipelineDesc);

    // We no longer need to access the shader module
    shaderModule.release();
}

bool Application::Initialize() {
    // We create a descriptor
    wgpu::InstanceDescriptor desc = {};
    desc.nextInChain = nullptr;

    // We create the instance using this descriptor
    instance = wgpu::createInstance(desc);

    // We can check whether there is actually an instance created
    if (!instance) {
        std::cerr << "Could not initialize WebGPU!" << std::endl;
        return 1;
    }

    wgpu::RequestAdapterOptions adapterOpts = {};
    adapterOpts.nextInChain = nullptr;
    adapter = instance.requestAdapter(adapterOpts);

    wgpu::DeviceDescriptor deviceDesc = {};
    deviceDesc.nextInChain = nullptr;
    deviceDesc.label = "My Device"; // anything works here, that's your call
    deviceDesc.requiredFeatureCount = 0; // we do not require any specific feature
    deviceDesc.defaultQueue.nextInChain = nullptr;
    deviceDesc.defaultQueue.label = "The default queue";

    // wgpu::RequiredLimits requiredLimits = GetRequiredLimits();
    // deviceDesc.requiredLimits = &requiredLimits;

    deviceDesc.deviceLostCallbackInfo = {};
    deviceDesc.deviceLostCallbackInfo.mode = wgpu::CallbackMode::AllowSpontaneous;
    deviceDesc.deviceLostCallbackInfo.callback = [](WGPUDevice const* /* device */, WGPUDeviceLostReason reason, const char* message, void* /* pUserdata */) {
        std::cout << "Device lost: reason " << reason;
        if (message) std::cout << " (" << message << ")";
        std::cout << std::endl;
    };

    device = adapter.requestDevice(deviceDesc);

    auto onDeviceError = [](wgpu::ErrorType type, char const* message) {
        std::cout << "Uncaptured device error: type " << type;
        if (message) std::cout << " (" << message << ")";
        std::cout << std::endl;
    };

    uncapturedErrorCallbackHandle = device.setUncapturedErrorCallback(onDeviceError);

    queue = device.getQueue();

    if (!glfwInit()) {
        std::cerr << "Could not initialize GLFW!" << std::endl;
        return 1;
    }

    glfwWindowHint(GLFW_CLIENT_API, GLFW_NO_API); // <-- extra info for glfwCreateWindow
    glfwWindowHint(GLFW_RESIZABLE, GLFW_FALSE);

    window = glfwCreateWindow(640, 480, "Learn WebGPU", nullptr, nullptr);

    // Get the surface
    surface = glfwGetWGPUSurface(instance, window);

    wgpu::SurfaceCapabilities surfaceCapability;
    surface.getCapabilities(adapter, &surfaceCapability);

    surfaceFormat = surfaceCapability.formats[0];
    wgpu::CompositeAlphaMode surfaceAlphaMode = surfaceCapability.alphaModes[0];

    wgpu::SurfaceConfiguration config = {};
    config.nextInChain = nullptr;
    config.width = 640;
    config.height = 480;
    config.format = surfaceFormat;
    config.viewFormatCount = 0;
    config.viewFormats = nullptr;
    config.usage = wgpu::TextureUsage::RenderAttachment;
    config.device = device;
    config.presentMode = wgpu::PresentMode::Fifo;
    config.alphaMode = surfaceAlphaMode;

    surface.configure(config);

    InitializePipeline();
    InitializeBuffers();    

    return true;
}

void Application::Terminate() {
    // Move all the release/destroy/terminate calls here
    indexBuffer.release();
    vertexBuffer.release();
    pipeline.release();
    
    surface.unconfigure();
    surface.release();

    glfwDestroyWindow(window);
    
    queue.release();
    device.release();
    adapter.release();
    instance.release();
}

void Application::MainLoop() {
    glfwPollEvents();

    // Create some CPU-side data buffer (of size 16 bytes)
    std::vector<uint8_t> numbers(16);
    for (uint8_t i = 0; i < 16; ++i) numbers[i] = i;
    // `numbers` now contains [ 0, 1, 2, ... ]

    wgpu::CommandEncoderDescriptor encoderDesc = {};
    encoderDesc.nextInChain = nullptr;
    encoderDesc.label = "My command encoder";
    wgpu::CommandEncoder encoder = device.createCommandEncoder(encoderDesc);

    // Get the next target texture view
    wgpu::TextureView targetView = GetNextSurfaceTextureView();
    if (!targetView) return;

    wgpu::RenderPassColorAttachment renderPassColorAttachment = {};
    renderPassColorAttachment.view = targetView;
    renderPassColorAttachment.resolveTarget = nullptr;
    renderPassColorAttachment.loadOp = wgpu::LoadOp::Clear;
    renderPassColorAttachment.storeOp = wgpu::StoreOp::Store;
    renderPassColorAttachment.clearValue = wgpu::Color{ 0.9, 0.1, 0.2, 1.0 };

#ifndef WEBGPU_BACKEND_WGPU
    renderPassColorAttachment.depthSlice = WGPU_DEPTH_SLICE_UNDEFINED;
#endif // NOT WEBGPU_BACKEND_WGPU

    wgpu::RenderPassDescriptor renderPassDesc = {};
    renderPassDesc.nextInChain = nullptr;
    renderPassDesc.colorAttachmentCount = 1;
    renderPassDesc.colorAttachments = &renderPassColorAttachment;
    renderPassDesc.depthStencilAttachment = nullptr;
    renderPassDesc.timestampWrites = nullptr;

    wgpu::RenderPassEncoder renderPass = encoder.beginRenderPass(renderPassDesc);

    // Select which render pipeline to use
    renderPass.setPipeline(pipeline);

    // Set vertex buffer while encoding the render pass
    renderPass.setVertexBuffer(0, vertexBuffer, 0, vertexBuffer.getSize());
    
    // Set index buffer while encoding the render pass
    renderPass.setIndexBuffer(indexBuffer, wgpu::IndexFormat::Uint16, 0, indexBuffer.getSize());

    // We use the `vertexCount` variable instead of hard-coding the vertex count
    renderPass.drawIndexed(indexCount, 1, 0, 0, 0);

    renderPass.end();
    renderPass.release();

    wgpu::CommandBufferDescriptor cmdBufferDescriptor = {};
    cmdBufferDescriptor.nextInChain = nullptr;
    cmdBufferDescriptor.label = "Command buffer";
    wgpu::CommandBuffer command = encoder.finish(cmdBufferDescriptor);
    encoder.release();

    queue.submit(1, &command); 
    command.release();

    targetView.release();
    surface.present();
}

bool Application::IsRunning() {
    return !glfwWindowShouldClose(window);
}

int main (int, char**) {
    Application app;

    if (!app.Initialize()) {
        return 1;
    }

    // Warning: this is still not Emscripten-friendly, see below
    while (app.IsRunning()) {
        app.MainLoop();
    }

    app.Terminate();

    return 0;
}
