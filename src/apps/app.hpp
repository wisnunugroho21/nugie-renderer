#pragma once

#include <vector>
#include <memory>

#include "../render/renderer.hpp"

namespace nugie {
    class Application {
    public:
        Application();
        void run();

    private:
        std::unique_ptr<Device> device;
        std::unique_ptr<Renderer> renderers;
    };
}