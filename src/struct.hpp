#pragma once

#include "buffer/child/child_buffer.hpp"

namespace nugie {
    struct Mesh {
        ChildBuffer vertexBuffer;
        ChildBuffer indexBuffer;
        uint32_t indexCount;
    };
}