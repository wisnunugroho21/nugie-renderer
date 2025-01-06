#include "renderer.hpp"

namespace nugie {
    void Renderer::initialize(Device* device) {
        this->initializeBuffers(device);

        for (auto &&renderSystem : this->renderSystems) {
            renderSystem->initialize(device);
        }
    }

    void Renderer::render(Device* device) {
        wgpu::CommandEncoderDescriptor commandEncoderDesc = {};
        commandEncoderDesc.nextInChain = nullptr;
        commandEncoderDesc.label = "Frame Command Encoder";

        // Get the command encoder
        wgpu::CommandEncoder commandEncoder = device->createCommandEncoder(commandEncoderDesc);
        if (!commandEncoder) return;

        // Get the next target texture view
        wgpu::TextureView surfaceTextureView = device->getNextSurfaceTextureView();
        if (!surfaceTextureView) return;

        for (auto &&renderSystem : this->renderSystems) {
            for (auto &&meshBuffer : this->meshBuffers) {
                renderSystem->render(commandEncoder, surfaceTextureView, meshBuffer);
            }
        }

        wgpu::CommandBufferDescriptor cmdBufferDescriptor{};
        cmdBufferDescriptor.nextInChain = nullptr;
        cmdBufferDescriptor.label = "Command Buffer";

        wgpu::CommandBuffer commandBuffer = commandEncoder.finish(cmdBufferDescriptor);
        commandEncoder.release();

        device->getQueue().submit(1, &commandBuffer); 
        commandBuffer.release();
        
        device->getSurface().present();
        surfaceTextureView.release();
    }

    void Renderer::destroy() {
        for (auto &&renderSystem : this->renderSystems) {
            renderSystem->destroy();
        }
        
        delete this->vertexBuffer;
        delete this->indexBuffer;
    }

    void Renderer::initializeBuffers(Device* device) {
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
        // uint32_t indexCount = static_cast<uint32_t>(indexData.size());

        // Create vertex buffer
        wgpu::BufferDescriptor bufferDesc;
        bufferDesc.size = pointData.size() * sizeof(float);
        bufferDesc.usage = wgpu::BufferUsage::CopyDst | wgpu::BufferUsage::Vertex; // Vertex usage here!
        bufferDesc.mappedAtCreation = false;
        vertexBuffer = device->createMasterBuffer(bufferDesc);

        // Upload geometry data to the buffer
        device->getQueue().writeBuffer(vertexBuffer->getNative(), 0, pointData.data(), bufferDesc.size);

        // Create index buffer
        bufferDesc.size = indexData.size() * sizeof(uint16_t);
        bufferDesc.usage = wgpu::BufferUsage::CopyDst | wgpu::BufferUsage::Index; // Index usage here!
        indexBuffer = device->createMasterBuffer(bufferDesc);
        
        // Upload geometry data to the buffer
        device->getQueue().writeBuffer(indexBuffer->getNative(), 0, indexData.data(), bufferDesc.size);

        meshBuffers.clear();
        meshBuffers.emplace_back(MeshBuffer{
            .vertexBuffer = this->vertexBuffer->createChildBuffer(ULLONG_MAX),
            .indexBuffer = this->indexBuffer->createChildBuffer(ULLONG_MAX),
            .indexCount = static_cast<uint32_t>(indexData.size())
        });
    }
}