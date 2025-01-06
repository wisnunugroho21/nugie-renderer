#include "child_buffer.hpp"

namespace nugie {
    BufferInfo ChildBuffer::getInfo() {
        return BufferInfo{
            .buffer = this->master->getNative(),
            .offset = this->offset,
            .size = this->size
        };
    }
}