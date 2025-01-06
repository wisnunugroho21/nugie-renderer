#include "child_buffer.hpp"

namespace nugie {
    BufferInfo ChildBuffer::getInfo() {
        return BufferInfo{
            .buffer = this->master->getNative(),
            .offset = this->offset,
            .size = this->size
        };
    }

    void ChildBuffer::write(void* data) {
        this->master->write(data, this->size, this->offset);
    }
}