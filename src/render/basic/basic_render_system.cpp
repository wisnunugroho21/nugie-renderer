#include "basic_render_system.hpp"

#include "glm/vec4.hpp"
#include "../renderer.hpp"

namespace nugie {
    void BasicRenderSystem::initializePipeline(Device* device) {
        const char* shaderSource = R"(
            @vertex
            fn vs_main(@location(0) in_vertex_position: vec4f) -> @builtin(position) vec4f {
                return in_vertex_position;
            }

            @fragment
            fn fs_main() -> @location(0) vec4f {
                return vec4f(1.0, 0.0, 0.0, 1.0);
            }
        )";

        wgpu::ShaderModuleWGSLDescriptor shaderCodeDesc{};
        shaderCodeDesc.chain.next = nullptr;
        shaderCodeDesc.chain.sType = wgpu::SType::ShaderModuleWGSLDescriptor;
        shaderCodeDesc.code = shaderSource;    

        wgpu::ShaderModuleDescriptor shaderDesc{};
        shaderDesc.nextInChain = &shaderCodeDesc.chain;

        wgpu::ShaderModule shaderModule = device->createShaderModule(shaderDesc);

        wgpu::VertexAttribute positionAttrib{};
        positionAttrib.shaderLocation = 0;
        positionAttrib.format = wgpu::VertexFormat::Float32x4;
        positionAttrib.offset = 0;

        wgpu::VertexBufferLayout vertexBufferLayout{};
        vertexBufferLayout.attributeCount = 1;
        vertexBufferLayout.attributes = &positionAttrib;
        vertexBufferLayout.arrayStride = sizeof(glm::vec4);
        vertexBufferLayout.stepMode = wgpu::VertexStepMode::Vertex;

        wgpu::BlendState blendState{};
        blendState.color.srcFactor = wgpu::BlendFactor::SrcAlpha;
        blendState.color.dstFactor = wgpu::BlendFactor::OneMinusSrcAlpha;
        blendState.color.operation = wgpu::BlendOperation::Add;

        blendState.alpha.srcFactor = wgpu::BlendFactor::One;
        blendState.alpha.dstFactor = wgpu::BlendFactor::Zero;
        blendState.alpha.operation = wgpu::BlendOperation::Add;

        wgpu::ColorTargetState colorTarget{};
        colorTarget.format = device->getSurfaceFormat();
        colorTarget.blend = &blendState;
        colorTarget.writeMask = wgpu::ColorWriteMask::All;

        wgpu::FragmentState fragmentState{};
        fragmentState.module = shaderModule;
        fragmentState.entryPoint = "fs_main";
        fragmentState.constantCount = 0;
        fragmentState.constants = nullptr;
        fragmentState.targetCount = 1;
        fragmentState.targets = &colorTarget;

        wgpu::RenderPipelineDescriptor pipelineDesc{};
        pipelineDesc.vertex.bufferCount = 1;
        pipelineDesc.vertex.buffers = &vertexBufferLayout;
        pipelineDesc.vertex.module = shaderModule;
        pipelineDesc.vertex.entryPoint = "vs_main";
        pipelineDesc.vertex.constantCount = 0;
        pipelineDesc.vertex.constants = nullptr;

        pipelineDesc.primitive.topology = wgpu::PrimitiveTopology::TriangleList;
        pipelineDesc.primitive.stripIndexFormat = wgpu::IndexFormat::Undefined;
        pipelineDesc.primitive.frontFace = wgpu::FrontFace::CCW;
        pipelineDesc.primitive.cullMode = wgpu::CullMode::None;

        pipelineDesc.fragment = &fragmentState;
        pipelineDesc.depthStencil = nullptr;
        pipelineDesc.multisample.count = 1;
        pipelineDesc.multisample.mask = ~0u;
        pipelineDesc.multisample.alphaToCoverageEnabled = false;
        pipelineDesc.layout = nullptr;

        pipeline = device->createRenderPipeline(pipelineDesc);

        shaderModule.release();
    }

    void BasicRenderSystem::initialize(Device* device) {
        this->initializePipeline(device);
    }

    void BasicRenderSystem::render(wgpu::CommandEncoder commandEncoder, wgpu::TextureView surfaceTextureView, MeshBuffer meshBuffer) {
        wgpu::RenderPassColorAttachment renderPassColorAttachment{};
        renderPassColorAttachment.view = surfaceTextureView;
        renderPassColorAttachment.resolveTarget = nullptr;
        renderPassColorAttachment.loadOp = wgpu::LoadOp::Clear;
        renderPassColorAttachment.storeOp = wgpu::StoreOp::Store;
        renderPassColorAttachment.clearValue = wgpu::Color{ 0.0, 0.0, 0.0, 0.0 };

    #ifndef WEBGPU_BACKEND_WGPU
        renderPassColorAttachment.depthSlice = WGPU_DEPTH_SLICE_UNDEFINED;
    #endif // NOT WEBGPU_BACKEND_WGPU

        wgpu::RenderPassDescriptor renderPassDesc{};
        renderPassDesc.nextInChain = nullptr;
        renderPassDesc.colorAttachmentCount = 1;
        renderPassDesc.colorAttachments = &renderPassColorAttachment;
        renderPassDesc.depthStencilAttachment = nullptr;
        renderPassDesc.timestampWrites = nullptr;

        wgpu::RenderPassEncoder renderPass = commandEncoder.beginRenderPass(renderPassDesc);

        renderPass.setPipeline(this->pipeline);

        BufferInfo bufferInfo = meshBuffer.vertexBuffer.getInfo();
        renderPass.setVertexBuffer(0, bufferInfo.buffer, bufferInfo.offset, bufferInfo.size);
        
        bufferInfo = meshBuffer.indexBuffer.getInfo();
        renderPass.setIndexBuffer(bufferInfo.buffer, wgpu::IndexFormat::Uint16, bufferInfo.offset, bufferInfo.size);

        renderPass.drawIndexed(meshBuffer.indexCount, 1, 0, 0, 0);

        renderPass.end();
        renderPass.release();
    }

    void BasicRenderSystem::destroy() {
        this->pipeline.release();
    }
}