#pragma once

#include "buffer/child/child_buffer.hpp"
#include <vector>

namespace nugie {
    struct Mesh {
        std::vector<float> positionVertices;
        std::vector<uint16_t> indices;
    };

    struct MeshBuffer {
        ChildBuffer vertexBuffer;
        ChildBuffer indexBuffer;
        uint32_t indexCount;
    };
}