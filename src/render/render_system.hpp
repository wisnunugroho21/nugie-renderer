#pragma once

#include "../device/device.hpp"

namespace nugie {
    class RenderSystem {
    public:
        virtual void initialize(Device* device) = 0;

        virtual void render(Device* device, wgpu::Buffer vertexBuffer, 
            wgpu::Buffer indexBuffer, uint32_t indexCount) = 0;

        virtual void destroy() = 0;
    };
}