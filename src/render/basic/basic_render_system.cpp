#include "basic_render_system.hpp"

namespace nugie {
    void BasicRenderSystem::initializePipeline(Device* device) {
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

        wgpu::ShaderModule shaderModule = device->createShaderModule(shaderDesc);

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
        colorTarget.format = device->getSurfaceFormat();
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

        pipeline = device->createRenderPipeline(pipelineDesc);

        // We no longer need to access the shader module
        shaderModule.release();
    }

    void BasicRenderSystem::initialize(Device* device) {
        this->initializePipeline(device);
    }

    void BasicRenderSystem::render(Device* device, wgpu::Buffer vertexBuffer, 
            wgpu::Buffer indexBuffer, uint32_t indexCount) 
    {
        // Create some CPU-side data buffer (of size 16 bytes)
        std::vector<uint8_t> numbers(16);
        for (uint8_t i = 0; i < 16; ++i) numbers[i] = i;
        // `numbers` now contains [ 0, 1, 2, ... ]

        wgpu::CommandEncoderDescriptor encoderDesc = {};
        encoderDesc.nextInChain = nullptr;
        encoderDesc.label = "My command encoder";
        wgpu::CommandEncoder encoder = device->createCommandEncoder(encoderDesc);

        // Get the next target texture view
        wgpu::TextureView targetView = device->getNextSurfaceTextureView();
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
        renderPass.setPipeline(this->pipeline);

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

        device->getQueue().submit(1, &command); 
        command.release();

        targetView.release();
        device->getSurface().present();
    }

    void BasicRenderSystem::destroy() {
        this->pipeline.release();
    }
}