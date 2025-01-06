#include "renderer.hpp"

namespace nugie {
    void Renderer::initialize(Device* device) {
        this->initializeBuffers(device);

        for (auto &&renderSystem : this->renderSystems) {
            renderSystem->initialize(device);
        }
    }

    void Renderer::render(Device* device) {
        wgpu::CommandEncoderDescriptor commandEncoderDesc{};
        commandEncoderDesc.nextInChain = nullptr;
        commandEncoderDesc.label = "Frame Command Encoder";

        wgpu::CommandEncoder commandEncoder = device->createCommandEncoder(commandEncoderDesc);
        if (!commandEncoder) return;

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
        std::vector<float> pointData = {
            -0.5, -0.5,
            +0.5, -0.5, 
            +0.5, +0.5,
            -0.5, +0.5, 
        };

        std::vector<uint16_t> indexData = {
            0, 1, 2,
            0, 2, 3 
        };

        wgpu::BufferDescriptor bufferDesc;
        bufferDesc.size = pointData.size() * sizeof(float);
        bufferDesc.usage = wgpu::BufferUsage::CopyDst | wgpu::BufferUsage::Vertex;
        bufferDesc.mappedAtCreation = false;
        vertexBuffer = device->createMasterBuffer(bufferDesc);

        device->getQueue().writeBuffer(vertexBuffer->getNative(), 0, pointData.data(), bufferDesc.size);

        bufferDesc.size = indexData.size() * sizeof(uint16_t);
        bufferDesc.usage = wgpu::BufferUsage::CopyDst | wgpu::BufferUsage::Index;
        indexBuffer = device->createMasterBuffer(bufferDesc);
        
        device->getQueue().writeBuffer(indexBuffer->getNative(), 0, indexData.data(), bufferDesc.size);

        meshBuffers.clear();
        meshBuffers.emplace_back(MeshBuffer{
            .vertexBuffer = this->vertexBuffer->createChildBuffer(ULLONG_MAX),
            .indexBuffer = this->indexBuffer->createChildBuffer(ULLONG_MAX),
            .indexCount = static_cast<uint32_t>(indexData.size())
        });
    }
}