#ifndef NUGIE_MASTER_BUFFER_HPP
#define NUGIE_MASTER_BUFFER_HPP

#include <memory>
#include "../../device/device.hpp"
#include "../child/child_buffer.hpp"

namespace nugie {
    class ChildBuffer;
    class Device;

    class MasterBuffer {
    public:
        MasterBuffer(nugie::Device *device, wgpu::BufferDescriptor desc);
        ~MasterBuffer();

        wgpu::Buffer getNative() { return this->buffer; }

        ChildBuffer createChildBuffer(uint64_t size = ULLONG_MAX);

        // =========================== wgpu::buffer function ===========================

        uint64_t getSize();

        void write(void* data, size_t size, uint64_t offset);

        void release();

    private:
        nugie::Device *device;
        uint64_t totalOffset = 0;

        wgpu::Buffer buffer;
    };
}

#endif