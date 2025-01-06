#pragma once

#include "../buffer/master/master_buffer.hpp"
#include "../buffer/child/child_buffer.hpp"
#include "../struct.hpp"
#include "render_system.hpp"

namespace nugie {
    class Renderer {
    public:
        Renderer(std::vector<RenderSystem*> renderSystems) : renderSystems{renderSystems} {}

        void initialize(Device* device);

        void load(std::vector<Mesh> meshes);

        void render(Device* device);

        void destroy();

    private:
        std::vector<RenderSystem*> renderSystems;

        MasterBuffer *vertexBuffer, *indexBuffer;
        std::vector<MeshBuffer> meshBuffers;

        void initializeBuffers(Device* device);
    };
}