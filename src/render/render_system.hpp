#pragma once

#include "../struct.hpp"
#include "../device/device.hpp"
#include "../buffer/child/child_buffer.hpp"

namespace nugie {
    class RenderSystem {
    public:
        virtual void initialize(Device* device) = 0;

        virtual void render(Device* device, MeshBuffer meshBuffer) = 0;

        virtual void destroy() = 0;
    };
}