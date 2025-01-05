#pragma once

#include "render_system.hpp"

namespace nugie {
    class Renderer {
    public:
        Renderer(std::vector<RenderSystem*> renderSystems) : renderSystems{renderSystems} {}

        void initialize(Device* device);

        void render(Device* device);

        void destroy();

    private:
        std::vector<RenderSystem*> renderSystems;

        wgpu::Buffer vertexBuffer, indexBuffer;
        uint32_t indexCount;

        void initializeBuffers(Device* device);
    };
}