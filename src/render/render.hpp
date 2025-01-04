#pragma once

#include "../device/device.hpp"

namespace nugie {
    class Renderer {
    public:
        virtual void initialize(Device* device) = 0;

        virtual void render(Device* device) = 0;

        virtual void destroy(Device* device) = 0;
    };
}