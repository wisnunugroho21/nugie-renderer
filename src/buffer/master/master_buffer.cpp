#include "master_buffer.hpp"

namespace nugie {
    MasterBuffer::MasterBuffer(nugie::Device *device, wgpu::BufferDescriptor desc) : device{device} {
        this->buffer = this->device->createBuffer(desc);
    }

    MasterBuffer::~MasterBuffer() {
        this->release();
    }
    
   ChildBuffer MasterBuffer::createChildBuffer(uint64_t size) {
        if (size == ULLONG_MAX) {
            size = this->buffer.getSize();
        }

        ChildBuffer childBuffer{ this, size, this->totalOffset };
        this->totalOffset += size;

        return childBuffer;
    }

    uint64_t MasterBuffer::getSize() {
        return this->buffer.getSize();
    }

    void MasterBuffer::release() {
        this->buffer.release();
    }
}