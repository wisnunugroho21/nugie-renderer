#pragma once

#include "../render_system.hpp"

namespace nugie {
    class BasicRenderSystem : public RenderSystem {
    public:
        void initialize(Device* device) override;

        void render(Device* device, Mesh mesh) override;

        void destroy() override;

    private:
        wgpu::RenderPipeline pipeline;
        wgpu::Buffer uniform;
        
        void initializePipeline(Device* device);
    };
}