#pragma once

#include <vector>
#include "glm/vec4.hpp"

#include "buffer/child/child_buffer.hpp"

namespace nugie {
    struct Mesh {
        std::vector<glm::vec4> positionVertices;
        std::vector<uint16_t> indices;
    };

    struct MeshBuffer {
        ChildBuffer vertexBuffer;
        ChildBuffer indexBuffer;
        uint32_t indexCount;
    };
}