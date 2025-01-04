#pragma once

#include "../render.hpp"

namespace nugie {
    class BasicRenderer : public Renderer {
    public:
        void initialize(Device* device) override;

        void render(Device* device) override;

        void destroy(Device* device) override;

    private:
        wgpu::Buffer vertexBuffer;
        wgpu::Buffer indexBuffer;
        uint32_t indexCount;

        wgpu::RenderPipeline pipeline;

        void initializeBuffers(Device* device);
        void initializePipeline(Device* device);
    };
}