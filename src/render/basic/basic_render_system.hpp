#pragma once

#include "../render_system.hpp"

namespace nugie {
    class BasicRenderSystem : public RenderSystem {
    public:
        void initialize(Device* device) override;

        void render(Device* device, wgpu::Buffer vertexBuffer, 
            wgpu::Buffer indexBuffer, uint32_t indexCount) override;

        void destroy() override;

    private:
        wgpu::RenderPipeline pipeline;
        
        void initializePipeline(Device* device);
    };
}