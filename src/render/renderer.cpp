#include "renderer.hpp"

namespace nugie {
    void Renderer::initialize(Device* device) {
        this->initializeBuffers(device);

        for (auto &&renderSystem : this->renderSystems) {
            renderSystem->initialize(device);
        }
    }

    void Renderer::render(Device* device) {
        for (auto &&renderSystem : this->renderSystems) {
            renderSystem->render(device, this->vertexBuffer, 
                this->indexBuffer, this->indexCount);
        }
    }

    void Renderer::destroy() {
        for (auto &&renderSystem : this->renderSystems) {
            renderSystem->destroy();
        }
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
        indexCount = static_cast<uint32_t>(indexData.size());

        // Create vertex buffer
        wgpu::BufferDescriptor bufferDesc;
        bufferDesc.size = pointData.size() * sizeof(float);
        bufferDesc.usage = wgpu::BufferUsage::CopyDst | wgpu::BufferUsage::Vertex; // Vertex usage here!
        bufferDesc.mappedAtCreation = false;
        vertexBuffer = device->createBuffer(bufferDesc);

        // Upload geometry data to the buffer
        device->getQueue().writeBuffer(vertexBuffer, 0, pointData.data(), bufferDesc.size);

        // Create index buffer
        bufferDesc.size = indexData.size() * sizeof(uint16_t);
        bufferDesc.usage = wgpu::BufferUsage::CopyDst | wgpu::BufferUsage::Index; // Index usage here!
        indexBuffer = device->createBuffer(bufferDesc);
        
        // Upload geometry data to the buffer
        device->getQueue().writeBuffer(indexBuffer, 0, indexData.data(), bufferDesc.size);
    }
}