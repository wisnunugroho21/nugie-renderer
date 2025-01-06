#include "renderer.hpp"

#include "glm/vec4.hpp"

namespace nugie {
    void Renderer::initialize(Device* device) {
        this->initializeBuffers(device);

        for (auto &&renderSystem : this->renderSystems) {
            renderSystem->initialize(device);
        }
    }

    void Renderer::load(std::vector<Mesh> meshes) {
        meshBuffers.clear();

        for (auto &&mesh : meshes) {
            MeshBuffer meshBuffer{
                .vertexBuffer = this->vertexBuffer->createChildBuffer(mesh.positionVertices.size() * sizeof(glm::vec4)),
                .indexBuffer = this->indexBuffer->createChildBuffer(mesh.indices.size() * sizeof(uint16_t)),
                .indexCount = static_cast<uint32_t>(mesh.indices.size())
            };

            meshBuffer.vertexBuffer.write(mesh.positionVertices.data());
            meshBuffer.indexBuffer.write(mesh.indices.data());

            meshBuffers.emplace_back(meshBuffer);
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
        wgpu::BufferDescriptor bufferDesc;
        bufferDesc.size = 25 * sizeof(glm::vec4);
        bufferDesc.usage = wgpu::BufferUsage::CopyDst | wgpu::BufferUsage::Vertex;
        bufferDesc.mappedAtCreation = false;
        vertexBuffer = device->createMasterBuffer(bufferDesc);

        bufferDesc.size = 50 * sizeof(uint16_t);
        bufferDesc.usage = wgpu::BufferUsage::CopyDst | wgpu::BufferUsage::Index;
        indexBuffer = device->createMasterBuffer(bufferDesc);
    }
}