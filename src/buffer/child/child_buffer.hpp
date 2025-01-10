#ifndef NUGIE_CHILD_BUFFER_HPP
#define NUGIE_CHILD_BUFFER_HPP

#include "../master/master_buffer.hpp"

namespace nugie {
    class MasterBuffer;
    
    struct BufferInfo {
        wgpu::Buffer buffer;
        uint64_t size;
        uint64_t offset;
    };

    class ChildBuffer {
    public:
        ChildBuffer(MasterBuffer* master, uint64_t size, uint64_t offset) 
        : master{master}, 
          size{size}, 
          offset{offset} 
        {

        }

        MasterBuffer* getMasterBuffer() { return this->master; }

        BufferInfo getInfo();

        // =========================== wgpu::buffer function ===========================

        void write(void* data);

    private:
        MasterBuffer* master;
        uint64_t size;
        uint64_t offset;
    };
}

#endif