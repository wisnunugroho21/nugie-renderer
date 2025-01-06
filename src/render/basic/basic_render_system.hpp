#pragma once

#include "../render_system.hpp"

namespace nugie {
    class BasicRenderSystem : public RenderSystem {
    public:
        void initialize(Device* device) override;

        void render(wgpu::CommandEncoder commandEncoder, wgpu::TextureView surfaceTextureView, MeshBuffer meshBuffer) override;

        void destroy() override;

    private:
        wgpu::RenderPipeline pipeline;
        wgpu::Buffer uniform;
        
        void initializePipeline(Device* device);
    };
}